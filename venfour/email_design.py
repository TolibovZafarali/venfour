"""The master Venfour email layout. Email definitions supply content, never styles."""

from dataclasses import dataclass
from html import escape


LAYOUT_VERSION = "2026-09-11.3"
# Match AppShell, the website theme, and its solid primary CTA; use local font fallbacks.
DESIGN = {
    "background": "#f5f7fa",
    "surface": "#ffffff",
    "ink": "#0b1f33",
    "body": "#506277",
    "muted": "#506277",
    "brand": "#155eef",
    "border": "#d9e1e8",
    "inset": "#f5f7fa",
    "font": "-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,Helvetica,sans-serif",
    "brand_font": "'Avenir Next','Century Gothic','Trebuchet MS',Arial,sans-serif",
    "width": 560,
}
LOGO_PATH = "/email/venfour-mark-v1.png"
LOGO_SOURCE_SHA256 = "77d30af02d08c53600bf413ca3c5bcbd488276f9542f0e142da485db7b084fca"
COMPANY_NAME = "Venfour LLC"
COMPANY_DESCRIPTION = "Independent vehicle valuation guidance"
BRAND_LINE = f"{COMPANY_NAME} · {COMPANY_DESCRIPTION}"
CODE_NOTE = "This code expires soon. Never share it with anyone."


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    html: str
    text: str
    version: str = LAYOUT_VERSION


def render_master(*, subject: str, heading: str, paragraphs: tuple[str, ...],
                  action: str, action_url: str, code: str, reply_to: str,
                  optional: bool, unsubscribe_url: str, brand_origin: str,
                  details: tuple[tuple[str, str], ...] = ()) -> RenderedEmail:
    """All values are text; URL and code validation belongs to the public renderer."""
    d = DESIGN
    body = "".join(
        f'<p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:{d["body"]}">{escape(p)}</p>'
        for p in paragraphs
    )
    detail_rows = "".join(
        f'<tr><th align="left" valign="top" style="padding:12px 12px 12px 0;border-bottom:1px solid {d["border"]};font-size:13px;line-height:1.6;font-weight:normal;color:{d["body"]}">{escape(label)}</th>'
        f'<td align="right" valign="top" style="padding:12px 0;border-bottom:1px solid {d["border"]};font-size:14px;line-height:1.6;color:{d["ink"]}">{escape(value)}</td></tr>'
        for label, value in details
    )
    detail_block = (
        f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0;border-top:1px solid {d["border"]}">{detail_rows}</table>'
        if details else ""
    )
    code_block = (
        f'<p class="vf-code" style="margin:24px 0 12px;padding:16px 12px;background:{d["inset"]};border:1px solid {d["border"]};border-radius:6px;text-align:center;font-family:Consolas,Monaco,monospace;font-size:26px;line-height:1.4;letter-spacing:3px;color:{d["ink"]}">{escape(code)}</p>'
        f'<p style="margin:0;font-size:13px;line-height:1.6;color:{d["muted"]}">{CODE_NOTE}</p>'
        if code else ""
    )
    # A table supplies the fill/padding in Word-based Outlook when rounded corners are ignored.
    button = (
        f'<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 0"><tr><td align="center" bgcolor="{d["brand"]}" style="border-radius:10px;mso-padding-alt:14px 20px">'
        f'<a href="{escape(action_url, quote=True)}" style="display:inline-block;border:1px solid {d["brand"]};border-radius:10px;padding:13px 19px;font-family:{d["font"]};font-size:14px;line-height:20px;font-weight:600;color:#ffffff;text-align:center;text-decoration:none;mso-padding-alt:0">{escape(action)}</a></td></tr></table>'
        if action_url else ""
    )
    support = (f"Need help? Reply to this email at {reply_to}." if reply_to else
               "Need help? Contact Venfour support through our website’s Contact page.")
    footer = ("You opted in to optional follow-up about your case." if optional else
              "You received this email about your Venfour account or a service you requested.")
    unsubscribe = (
        f'<p style="margin:12px 0 0"><a href="{escape(unsubscribe_url, quote=True)}" style="color:{d["muted"]};text-decoration:underline">Stop optional case reminders</a></p>'
        if unsubscribe_url else ""
    )
    logo_url = brand_origin + LOGO_PATH
    html = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>{escape(subject)}</title>
<style>@media only screen and (max-width:480px){{.vf-outer{{padding:20px 12px!important}}.vf-header{{padding:28px 24px 0!important}}.vf-content{{padding:24px!important}}.vf-footer{{padding:20px 24px 28px!important}}.vf-heading{{font-size:21px!important}}.vf-code{{font-size:24px!important;letter-spacing:2px!important}}}}</style></head>
<body style="margin:0;padding:0;background:{d["background"]};font-family:{d["font"]};color:{d["ink"]};-webkit-text-size-adjust:100%;text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">{escape(paragraphs[0] if paragraphs else heading)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="{d["background"]}" style="font-family:{d["font"]}"><tr><td class="vf-outer" align="center" style="padding:32px 16px">
<!--[if mso]><table role="presentation" width="{d["width"]}" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="{d["surface"]}" style="max-width:{d["width"]}px;background:{d["surface"]}">
<tr><td class="vf-header" style="padding:32px 40px 0">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-bottom:1px solid {d["border"]}"><tr>
<td width="28" valign="middle" style="width:28px;padding:0 0 24px"><img src="{escape(logo_url, quote=True)}" width="28" height="28" alt="" role="presentation" style="display:block;width:28px;height:28px;border:0;outline:none;background:#ffffff" /></td>
<td align="left" valign="middle" style="padding:0 0 24px 9px"><span class="notranslate" translate="no" style="font-family:{d["brand_font"]};font-size:20px;line-height:28px;font-weight:600;letter-spacing:-.7px;color:{d["ink"]}">Venfour</span></td>
</tr></table></td></tr>
<tr><td class="vf-content" align="left" style="padding:28px 40px 32px;overflow-wrap:anywhere">
<h1 class="vf-heading" style="font-size:22px;line-height:1.4;font-weight:600;letter-spacing:-.35px;margin:0 0 18px;color:{d["ink"]}">{escape(heading)}</h1>
{body}{detail_block}{code_block}{button}</td></tr>
<tr><td class="vf-footer" align="left" style="padding:24px 40px 32px;border-top:1px solid {d["border"]};font-size:12px;line-height:1.7;color:{d["muted"]};overflow-wrap:anywhere">
<p style="margin:0"><strong style="font-weight:600;color:{d["ink"]}">{COMPANY_NAME}</strong><br>{COMPANY_DESCRIPTION}</p>
<p style="margin:14px 0 0;font-size:13px;line-height:1.65">{escape(support)}</p>
<p style="margin:14px 0 0">{escape(footer)}</p>{unsubscribe}</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>'''
    parts = [heading, *paragraphs, *(f"{label}: {value}" for label, value in details)]
    if code:
        parts += [code, CODE_NOTE]
    if action_url:
        parts += [f"{action}: {action_url}"]
    parts += [BRAND_LINE, support, footer]
    if unsubscribe_url:
        parts += [f"Stop optional case reminders: {unsubscribe_url}"]
    return RenderedEmail(subject, html, "\n\n".join(parts))
