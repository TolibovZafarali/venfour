"""Export every shared email as HTML/plain text without contacting a provider."""
from __future__ import annotations
import argparse
import json
from html import escape
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from venfour.email_templates import TEMPLATES, render_auth_smtp, render_email, template_catalogue


def export(destination: Path):
    destination.mkdir(parents=True, exist_ok=True)
    previews = {}
    for key, template in TEMPLATES.items():
        code = "123456" if key in {"auth_sign_in", "auth_claim", "auth_reauthentication", "auth_email_change"} else ""
        rendered = render_email(key, code=code, action_url="" if code and key != "auth_email_change" else "https://example.test/preview",
            reply_to="support@venfour.test", unsubscribe_url="https://example.test/preferences" if template.category == "follow_up" else "", preview=True)
        (destination / f"{key}.html").write_text(rendered.html)
        (destination / f"{key}.txt").write_text(rendered.text)
        previews[key] = {"html": rendered.html, "text": rendered.text, "subject": rendered.subject, "version": rendered.version}
    (destination / "catalogue.json").write_text(json.dumps(template_catalogue(), indent=2))
    (destination / "previews.json").write_text(json.dumps(previews))
    links = "".join(f'<li><a href="{key}.html">{escape(t.subject)}</a> · <a href="{key}.txt">Plain text</a><p>{escape(t.trigger)}</p></li>' for key,t in TEMPLATES.items())
    (destination / "index.html").write_text('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Venfour email library</title><body style="max-width:760px;margin:48px auto;padding:24px;font:16px/1.6 Arial;color:#172741"><h1>Venfour email library</h1><p>Fictional previews. No email sent.</p><ul>'+links+'</ul></body></html>')
    print(f"Exported {len(TEMPLATES)} HTML and plain-text previews to {destination.resolve()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--write-smtp", action="store_true", help="Regenerate repository SMTP fallback templates; never update hosted Auth")
    parser.add_argument("--check-smtp", action="store_true", help="Check fallback files match the shared renderer")
    args = parser.parse_args()
    if args.write_smtp or args.check_smtp:
        context = (ROOT / "supabase/templates/auth-context.gohtml").read_text()
        compiled = render_auth_smtp(context)
        for name in ("confirmation", "magic-link"):
            target = ROOT / f"supabase/templates/{name}.html"
            if args.write_smtp:
                target.write_text(compiled)
            elif target.read_text() != compiled:
                raise SystemExit("SMTP fallback templates need regeneration")
    if args.output:
        export(args.output)
    elif not (args.write_smtp or args.check_smtp):
        parser.error("Choose --output, --write-smtp or --check-smtp")
