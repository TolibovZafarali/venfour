"""The master Venfour email layout. Email definitions supply content, never styles."""

from dataclasses import dataclass
from html import escape


LAYOUT_VERSION = "2026-09-11.2"
DESIGN = {
    "background": "#f4f6fa",
    "surface": "#ffffff",
    "ink": "#172741",
    "body": "#41516a",
    "muted": "#59687d",
    "brand": "#234ee6",
    "border": "#e3e8f0",
    "inset": "#edf2fb",
    "font": "Arial,Helvetica,sans-serif",
    "width": 560,
}
BRAND_LINE = "Venfour · Independent vehicle valuation guidance"
CODE_NOTE = "This code expires soon. Never share it with anyone."


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    html: str
    text: str
    version: str = LAYOUT_VERSION


def render_master(*, subject: str, heading: str, paragraphs: tuple[str, ...],
                  action: str, action_url: str, code: str, reply_to: str,
                  optional: bool, unsubscribe_url: str,
                  details: tuple[tuple[str, str], ...] = ()) -> RenderedEmail:
    """All values are text; URL and code validation belongs to the public renderer."""
    d = DESIGN
    body = "".join(
        f'<p style="margin:0 0 20px;font-size:16px;line-height:1.65;color:{d["body"]}">{escape(p)}</p>'
        for p in paragraphs
    )
    detail_rows = "".join(
        f'<tr><th align="left" style="padding:12px 16px;font-size:13px;font-weight:normal;color:{d["muted"]}">{escape(label)}</th>'
        f'<td align="right" style="padding:12px 16px;font-size:14px;color:{d["ink"]}">{escape(value)}</td></tr>'
        for label, value in details
    )
    detail_block = (
        f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0;background:{d["inset"]};border-radius:8px">{detail_rows}</table>'
        if details else ""
    )
    code_block = (
        f'<p class="vf-code" style="margin:28px 0 12px;padding:22px 8px;background:{d["inset"]};border-radius:8px;text-align:center;font-family:monospace;font-size:30px;letter-spacing:3px;color:{d["ink"]}">{escape(code)}</p>'
        f'<p style="margin:0;font-size:13px;line-height:1.6;color:{d["muted"]}">{CODE_NOTE}</p>'
        if code else ""
    )
    button = (
        f'<table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0"><tr><td bgcolor="{d["brand"]}" style="border-radius:8px;text-align:center">'
        f'<a href="{escape(action_url, quote=True)}" style="display:inline-block;border:1px solid {d["brand"]};border-radius:8px;padding:16px 24px;font-size:15px;line-height:1.4;font-weight:bold;color:#ffffff;text-decoration:none;mso-padding-alt:0"><!--[if mso]><i style="mso-font-width:150%;mso-text-raise:24pt" hidden>&emsp;</i><![endif]-->{escape(action)}<!--[if mso]><i style="mso-font-width:150%" hidden>&emsp;&#8203;</i><![endif]--></a></td></tr></table>'
        if action_url else ""
    )
    support = f"Questions? Reply to this email ({reply_to})." if reply_to else "Questions? Contact Venfour support."
    footer = ("You opted in to optional follow-up about your case." if optional else
              "You received this email about your Venfour account or a service you requested.")
    unsubscribe = (
        f'<p style="margin:12px 0 0"><a href="{escape(unsubscribe_url, quote=True)}" style="color:{d["muted"]};text-decoration:underline">Stop optional case reminders</a></p>'
        if unsubscribe_url else ""
    )
    html = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>{escape(subject)}</title>
<style>@media only screen and (max-width:480px){{.vf-outer{{padding:20px 12px!important}}.vf-card{{padding:28px 24px!important}}.vf-heading{{font-size:26px!important}}.vf-code{{font-size:26px!important;letter-spacing:2px!important}}}}</style></head>
<body style="margin:0;padding:0;background:{d["background"]};font-family:{d["font"]};color:{d["ink"]};-webkit-text-size-adjust:100%;text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">{escape(paragraphs[0] if paragraphs else heading)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="{d["background"]}"><tr><td class="vf-outer" align="center" style="padding:36px 20px">
<!--[if mso]><table role="presentation" width="{d["width"]}" cellspacing="0" cellpadding="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:{d["width"]}px"><tr><td style="padding:4px 4px 28px;font-size:26px;font-weight:bold;letter-spacing:-1.2px;color:{d["ink"]}">venfour<span style="color:{d["brand"]}">.</span></td></tr>
<tr><td class="vf-card" bgcolor="{d["surface"]}" style="border:1px solid {d["border"]};border-radius:16px;padding:40px;overflow-wrap:anywhere">
<p style="font-size:10px;line-height:1.6;letter-spacing:1.8px;color:{d["muted"]};margin:0 0 24px">CLARITY FOR YOUR NEXT STEP</p>
<h1 class="vf-heading" style="font-size:30px;line-height:1.2;font-weight:bold;letter-spacing:-.7px;margin:0 0 24px;color:{d["ink"]}">{escape(heading)}</h1>
{body}{detail_block}{code_block}{button}
<p style="font-size:13px;line-height:1.65;color:{d["muted"]};margin:28px 0 0">{escape(support)}</p></td></tr>
<tr><td style="padding:24px 8px 0;font-size:12px;line-height:1.7;color:{d["muted"]}">{escape(footer)}{unsubscribe}<p style="margin:16px 0 0">{BRAND_LINE}</p></td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>'''
    parts = [heading, *paragraphs, *(f"{label}: {value}" for label, value in details)]
    if code:
        parts += [code, CODE_NOTE]
    if action_url:
        parts += [f"{action}: {action_url}"]
    parts += [support, footer]
    if unsubscribe_url:
        parts += [f"Stop optional case reminders: {unsubscribe_url}"]
    parts += [BRAND_LINE]
    return RenderedEmail(subject, html, "\n\n".join(parts))
