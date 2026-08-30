"""Offline contract checks; actual Go rendering is verified with local Mailpit."""

from pathlib import Path
import tomllib
import unittest


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
                self.assertNotIn(".Data", template)

    def test_otp_branch_formats_only_six_characters_and_contains_no_link(self) -> None:
        for name, template in self.templates.items():
            with self.subTest(template=name):
                otp_branch = template.split("{{ if $claimCode }}", 1)[1].split(
                    "\n      {{ else }}\n", 1
                )[0]
                self.assertIn(TOKEN_DISPLAY, otp_branch)
                self.assertIn("Use this code to verify your claim:", otp_branch)
                self.assertIn(
                    "This code expires soon. If you didn't request it, "
                    "you can ignore this email.",
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
                self.assertIn("{{ if $previewReady }}View my result", fallback)
                self.assertIn("{{ else }}Continue securely{{ end }}", fallback)
                self.assertNotIn(".Token }}", fallback)
                self.assertNotIn("verification code", fallback)

    def test_subject_preserves_preview_and_default_subjects(self) -> None:
        subjects = self.config["auth"]["email"]["template"]
        self.assertEqual(subjects["confirmation"]["subject"], subjects["magic_link"]["subject"])
        for name in self.templates:
            subject = subjects[name]["subject"]
            with self.subTest(template=name):
                self.assertIn('{{ $c := print .SiteURL "/total-loss/cases/" }}', subject)
                self.assertIn(
                    "{{ if or (and (ge (len .RedirectTo) (len $c)) "
                    "(eq (slice .RedirectTo 0 (len $c)) $c)) "
                    '(and (eq .SiteURL "http://localhost:5173") '
                    "(ge (len .RedirectTo) (len $l)) "
                    "(eq (slice .RedirectTo 0 (len $l)) $l)) }}"
                    "Your Venfour verification code",
                    subject,
                )
                self.assertIn("Your Venfour valuation preview is ready", subject)
                self.assertIn('{{ $l := "http://127.0.0.1:5173/total-loss/cases/" }}', subject)
                self.assertIn("{{ else }}Continue your Venfour appraisal{{ end }}", subject)
                self.assertNotIn(".Token", subject)


if __name__ == "__main__":
    unittest.main()
