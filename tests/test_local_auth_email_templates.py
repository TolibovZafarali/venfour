"""Offline contract checks; actual Go rendering is verified with local Mailpit."""

from pathlib import Path
import tomllib
import unittest

from venfour.email_templates import TEMPLATES, render_auth_smtp_subject, smtp_templates
from scripts.preview_emails import configure_smtp


ROOT = Path(__file__).resolve().parents[1]
TOKEN_DISPLAY = (
    "{{ if eq (len .Token) 6 }}{{ slice .Token 0 3 }}-"
    "{{ slice .Token 3 6 }}{{ else }}{{ .Token }}{{ end }}"
)


class LocalAuthEmailTemplateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        with (ROOT / "supabase/config.toml").open("rb") as config_file:
            cls.config = tomllib.load(config_file)
        cls.templates = {
            name: (ROOT / template["content_path"]).read_text()
            for name, template in cls.config["auth"]["email"]["template"].items()
            if name in {"confirmation", "magic_link"}
        }

    def test_six_digit_code_keeps_existing_auth_limits_and_local_mailpit(self) -> None:
        email = self.config["auth"]["email"]
        self.assertEqual(email["otp_length"], 6)
        self.assertEqual(email["otp_expiry"], 3600)
        self.assertEqual(email["max_frequency"], "60s")
        self.assertEqual(self.config["auth"]["rate_limit"]["email_sent"], 30)
        self.assertTrue(self.config["local_smtp"]["enabled"])
        self.assertEqual(self.config["local_smtp"]["port"], 54324)
        self.assertNotIn("smtp", email)

    def test_purchase_redirect_allowlist_is_local_and_route_scoped(self) -> None:
        redirects = self.config["auth"]["additional_redirect_urls"]
        purchase_redirects = [url for url in redirects if "/total-loss/cases/" in url]
        self.assertEqual(
            purchase_redirects,
            [
                "http://localhost:5173/total-loss/cases/*/claim/checkout",
                "http://127.0.0.1:5173/total-loss/cases/*/claim/checkout",
            ],
        )
        for origin in ("http://localhost:5173", "http://127.0.0.1:5173"):
            for callback in (
                "/auth/callback",
                "/auth/callback/case-claim/*",
                "/auth/callback/preview/*/*",
                "/auth/callback/preview-ready/*/*",
            ):
                self.assertIn(origin + callback, redirects)

    def test_new_and_existing_account_templates_use_guarded_same_origin_selector(self) -> None:
        self.assertEqual(set(self.templates), {"confirmation", "magic_link"})
        for name, template in self.templates.items():
            with self.subTest(template=name):
                self.assertIn(
                    '{{ $claimPrefix := print .SiteURL "/total-loss/cases/" }}',
                    template,
                )
                self.assertIn(
                    "{{ $claimCode := or (and (ge (len .RedirectTo) (len $claimPrefix)) "
                    "(eq (slice .RedirectTo 0 (len $claimPrefix)) $claimPrefix))",
                    template,
                )
                self.assertIn(
                    '{{ $localClaimPrefix := "http://127.0.0.1:5173/total-loss/cases/" }}',
                    template,
                )
                self.assertIn(
                    '(and (eq .SiteURL "http://localhost:5173") '
                    "(ge (len .RedirectTo) (len $localClaimPrefix)) "
                    "(eq (slice .RedirectTo 0 (len $localClaimPrefix)) $localClaimPrefix)) }}",
                    template,
                )
                self.assertIn('{{ $signIn := print .SiteURL "/auth/callback" }}', template)
                self.assertIn('(eq .RedirectTo $signIn)', template)
                self.assertIn('{{ $signInQuery := print $signIn "?" }}', template)
                self.assertIn('(eq (slice .RedirectTo 0 (len $signInQuery)) $signInQuery)', template)
                self.assertIn('(and (eq .SiteURL "http://localhost:5173") (or (eq .RedirectTo $localSignIn)', template)
                self.assertNotIn(".Data", template)

    def test_otp_branch_formats_only_six_characters_and_contains_no_link(self) -> None:
        for name, template in self.templates.items():
            with self.subTest(template=name):
                otp_branch = template.split("{{ if or $claimCode $signInCode }}", 1)[1].split(
                    "\n      {{ else }}\n", 1
                )[0]
                self.assertIn(TOKEN_DISPLAY, otp_branch)
                self.assertIn(TEMPLATES["auth_sign_in"].paragraphs[0], otp_branch)
                self.assertIn(TEMPLATES["auth_claim"].paragraphs[0], otp_branch)
                self.assertIn(
                    "This code expires soon. Never share it with anyone.",
                    otp_branch,
                )
                for link_marker in ("<a", "href=", ".TokenHash", ".ConfirmationURL"):
                    self.assertNotIn(link_marker, otp_branch)

    def test_old_preview_intake_and_recovery_links_remain_in_fallback_branch(self) -> None:
        for name, template in self.templates.items():
            with self.subTest(template=name):
                fallback = template.split("\n      {{ else }}\n", 1)[1]
                self.assertIn(
                    'href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=email"',
                    fallback,
                )
                self.assertIn("{{ if $previewReady }}", fallback)
                self.assertIn("View my result", fallback)
                self.assertIn("Continue securely", fallback)
                self.assertNotIn(".Token }}", fallback)
                self.assertNotIn("verification code", fallback)

    def test_subject_preserves_preview_and_default_subjects(self) -> None:
        subjects = self.config["auth"]["email"]["template"]
        context = (ROOT / "supabase/templates/auth-context.gohtml").read_text()
        for name in self.templates:
            subject = subjects[name]["subject"]
            self.assertEqual(subject, render_auth_smtp_subject(context))
            for key in ("auth_sign_in", "auth_claim", "auth_preview_ready", "auth_access"):
                self.assertIn(TEMPLATES[key].subject, subject)
            self.assertIn('{{ $claimPrefix := print .SiteURL "/total-loss/cases/" }}', subject)
            self.assertIn('(eq .SiteURL "http://localhost:5173")', subject)
            self.assertNotIn('.Token', subject)

    def test_all_smtp_slots_are_generated_and_keep_notification_switches_off(self):
        context = (ROOT / "supabase/templates/auth-context.gohtml").read_text()
        entries = smtp_templates(context)
        self.assertEqual(len(entries), 13)
        for name, entry in entries.items():
            self.assertEqual((ROOT / f"supabase/templates/{name}.html").read_text(), entry['html'])
            section = self.config
            for part in entry['section'].split('.'):
                section = section[part]
            self.assertEqual(section['subject'], entry['subject'])
            self.assertEqual(section['content_path'], f'./supabase/templates/{name}.html')
            if '.notification.' in entry['section']:
                self.assertFalse(section['enabled'])
                self.assertNotIn('href=', entry['html'])
        for name in ('invite', 'recovery', 'email_change'):
            self.assertIn('href="{{ .ConfirmationURL }}"', entries[name]['html'])
        self.assertNotIn('href=', entries['reauthentication']['html'])

    def test_generation_preserves_runtime_configuration_and_enabled_switches(self):
        config = (ROOT / 'supabase/config.toml').read_text()
        entries = smtp_templates((ROOT / 'supabase/templates/auth-context.gohtml').read_text())
        self.assertEqual(configure_smtp(config, entries), config)
        modified = config.replace('[auth.email.notification.password_changed]\nenabled = false',
                                  '[auth.email.notification.password_changed]\nenabled = true')
        result = tomllib.loads(configure_smtp(modified, entries))
        self.assertTrue(result['auth']['email']['notification']['password_changed']['enabled'])
        for section in ('api', 'db', 'storage', 'local_smtp'):
            self.assertEqual(result[section], self.config[section])


if __name__ == "__main__":
    unittest.main()
