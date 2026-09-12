"""Export every shared email as HTML/plain text without contacting a provider."""
from __future__ import annotations
import argparse
import json
import re
import tomllib
from html import escape
from pathlib import Path
import sys
import shutil

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from venfour.email_templates import TEMPLATES, render_preview, smtp_templates, template_catalogue
from venfour.email_design import LOGO_PATH


def configure_smtp(config: str, entries: dict) -> str:
    """Update only generated subjects/paths. Preserve all Auth and notification toggles."""
    for name, entry in entries.items():
        section = entry['section']
        fields = {'subject': entry['subject'], 'content_path': f'./supabase/templates/{name}.html'}
        match = re.search(r'^\[' + re.escape(section) + r'\]\n.*?(?=^\[|\Z)', config, re.MULTILINE | re.DOTALL)
        if match:
            block = match[0].rstrip()
            for key, value in fields.items():
                line = f'{key} = {json.dumps(value, ensure_ascii=False)}'
                if re.search(r'^' + key + r'\s*=', block, re.MULTILINE):
                    block = re.sub(r'^' + key + r'\s*=.*$', lambda _: line, block, flags=re.MULTILINE)
                else:
                    block += '\n' + line
            config = config[:match.start()] + block + '\n\n' + config[match.end():]
        else:
            block = f'\n[{section}]\n'
            if '.notification.' in section:
                block += 'enabled = false\n'
            config += block + '\n'.join(f'{key} = {json.dumps(value, ensure_ascii=False)}' for key, value in fields.items()) + '\n'
    tomllib.loads(config)
    return config.rstrip() + '\n'


def export(destination: Path, *, asset_origin: str = "https://venfour.com"):
    destination.mkdir(parents=True, exist_ok=True)
    previews = {}
    for key, template in TEMPLATES.items():
        rendered = render_preview(key, reply_to="support@venfour.test", brand_origin=asset_origin)
        (destination / f"{key}.html").write_text(rendered.html)
        (destination / f"{key}.txt").write_text(rendered.text)
        previews[key] = {"html": rendered.html, "text": rendered.text, "subject": rendered.subject, "version": rendered.version}
    (destination / "catalogue.json").write_text(json.dumps(template_catalogue(), indent=2))
    (destination / "previews.json").write_text(json.dumps(previews))
    asset = destination / LOGO_PATH.lstrip('/')
    asset.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / 'frontend/public' / LOGO_PATH.lstrip('/'), asset)
    links = "".join(f'<li><a href="{key}.html">{escape(t.subject)}</a> · <a href="{key}.txt">Plain text</a><p>{escape(t.trigger)}</p></li>' for key,t in TEMPLATES.items())
    (destination / "index.html").write_text('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Venfour email library</title><body style="max-width:760px;margin:48px auto;padding:24px;font:16px/1.6 Arial;color:#172741"><h1>Venfour email library</h1><p>Fictional previews. No email sent.</p><ul>'+links+'</ul></body></html>')
    print(f"Exported {len(TEMPLATES)} HTML and plain-text previews to {destination.resolve()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--asset-origin", default="https://venfour.com", help="Public website origin serving the logo; use your loopback preview origin locally")
    parser.add_argument("--write-smtp", action="store_true", help="Regenerate repository SMTP fallback templates; never update hosted Auth")
    parser.add_argument("--check-smtp", action="store_true", help="Check fallback files match the shared renderer")
    args = parser.parse_args()
    if args.write_smtp or args.check_smtp:
        context = (ROOT / "supabase/templates/auth-context.gohtml").read_text()
        entries = smtp_templates(context)
        for name, entry in entries.items():
            target = ROOT / f"supabase/templates/{name}.html"
            if args.write_smtp:
                target.write_text(entry['html'])
            elif not target.exists() or target.read_text() != entry['html']:
                raise SystemExit("SMTP fallback templates need regeneration")
        target = ROOT / 'supabase/config.toml'
        configured = configure_smtp(target.read_text(), entries)
        if args.write_smtp:
            target.write_text(configured)
        elif target.read_text() != configured:
            raise SystemExit('SMTP subjects and paths need regeneration')
    if args.output:
        export(args.output, asset_origin=args.asset_origin)
    elif not (args.write_smtp or args.check_smtp):
        parser.error("Choose --output, --write-smtp or --check-smtp")
