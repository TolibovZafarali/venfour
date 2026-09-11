"""Versioned transactional copy and the shared, dependency-free email layout."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from html import escape
from urllib.parse import urlsplit


LAYOUT_VERSION = "2026-09-11.1"


@dataclass(frozen=True)
class EmailTemplate:
    key: str
    subject: str
    heading: str
    paragraphs: tuple[str, ...]
    action: str = "Open Venfour"
    category: str = "transactional"
    identity: str = "customer"
    trigger: str = ""


def _template(key, subject, body, *, heading=None, action="Open Venfour",
              category="transactional", identity="customer", trigger=""):
    return EmailTemplate(key, subject, heading or subject, tuple(body), action, category, identity, trigger)


TEMPLATES = {t.key: t for t in (
    _template("auth_sign_in", "Your Venfour sign-in code", ["Use this code to sign in to Venfour. Enter it only on the page where you requested it.", "If you did not request this code, you can ignore this email."], identity="auth", trigger="Requested email sign-in or signup"),
    _template("auth_claim", "Your Venfour verification code", ["Use this code to verify your email and continue your saved case.", "Verification does not purchase a review or send anything to your insurer."], identity="auth", trigger="Requested checkout claim verification"),
    _template("auth_access", "Continue your Venfour appraisal", ["Use this secure, one-time link to verify your email and return to your saved appraisal.", "If the link expires, request a fresh link from the same page. If you did not request access, you can ignore this email."], action="Continue securely", identity="auth", trigger="Requested case access or preview recovery"),
    _template("auth_preview_ready", "Your Venfour valuation preview is ready", ["Your saved preview is ready. Return to see your result and the available next steps.", "If verification expires, request a fresh link from the same page."], action="View my result", identity="auth", trigger="Existing guest preview completion queue"),
    _template("auth_invite", "Your invitation to Venfour", ["You have been invited to create a Venfour account. Continue securely to review the invitation."], action="Review invitation", identity="auth", trigger="Supabase administrator account invitation"),
    _template("auth_recovery", "Reset your Venfour password", ["Use this secure link to continue your requested password reset.", "If you did not request this, you can ignore this email."], action="Continue securely", identity="auth", trigger="Supabase password recovery request"),
    _template("auth_email_change", "Confirm your Venfour email change", ["Confirm the email change you requested for your Venfour account.", "If you did not request this change, contact support using the reply address below."], action="Confirm email change", identity="auth", trigger="Supabase email change; both addresses when secure change is enabled"),
    _template("auth_reauthentication", "Confirm it’s you", ["Use this verification code to confirm the account action you requested.", "Do not share this code. Venfour support will never ask for it."], identity="auth", trigger="Supabase reauthentication"),
    *(_template("auth_" + key, title, ["This security change was recorded on your Venfour account.", "If you did not make this change, contact support using the reply address below."], identity="auth", trigger="Optional Supabase security notification; provider toggle controls sending") for key, title in (
        ("password_changed_notification", "Your Venfour password was changed"),
        ("email_changed_notification", "Your Venfour email address was changed"),
        ("phone_changed_notification", "Your Venfour phone number was changed"),
        ("mfa_factor_enrolled_notification", "A verification method was added"),
        ("mfa_factor_unenrolled_notification", "A verification method was removed"),
        ("identity_linked_notification", "A sign-in method was linked"),
        ("identity_unlinked_notification", "A sign-in method was removed"),
    )),
    _template("partner_invitation", "Your invitation to become a Venfour referral partner", ["Venfour has invited your business to join its referral partner program.", "Verify your email, complete your business details, and review the agreement before deciding whether to sign.", "This invitation expires seven days after it was issued. Opening the link does not accept the invitation or sign an agreement."], action="Review invitation", identity="partner", trigger="Authorized manager invitation or replacement invitation"),
    _template("partner_agreement_copy", "Your completed Venfour referral partner agreement", ["Your completed referral partner agreement is attached. This is the same retained PDF available in your Venfour partner dashboard.", "Your onboarding is complete. Open your partner workspace to share your referral link and follow your referral activity."], action="Open partner workspace", identity="partner", trigger="Retained countersigned PDF ready or explicit additional copy"),
    _template("intake_reminder", "Your saved Venfour review is here", ["You can return to the details you have already saved whenever you are ready.", "Check your information and continue from where you left off."], action="Continue my review", category="follow_up", trigger="Unfinished intake, 24 hours without activity; once per case"),
    _template("free_review_ready", "Your Venfour review is ready", ["Your saved review is ready. Open Venfour to see what the evidence supports and what to do next."], action="View my review", trigger="Current completed free analysis for a verified owner; existing guest-origin notification excluded"),
    _template("free_review_reminder", "Return to your saved review", ["Your review is saved in Venfour. You can return to your result and consider your next step whenever you are ready.", "No action is required if you have everything you need."], action="View my review", category="follow_up", trigger="Free review complete, no purchase and no activity for 72 hours; once per case, no sales promotion"),
    _template("paid_review_started", "Your Venfour review is underway", ["Your purchase has been confirmed and your detailed review is being prepared.", "You can return to your case to check progress. We will let you know when the review is ready."], action="View my case", trigger="Server-confirmed paid order and active entitlement; five-minute coalescing window"),
    _template("paid_review_ready", "Your detailed Venfour review is ready", ["Your report and supporting explanation are ready in your private case workspace.", "Review the evidence and the available next steps before deciding what to share with your adjuster."], action="View my review", trigger="Current report published and accessible under existing report-access contract"),
    _template("request_reminder", "Your prepared request is saved", ["Your request is prepared in Venfour. Review it, attach the supporting report, and send it from your own email account when you are ready.", "If you have already sent it, record that in your case to keep your progress up to date. Venfour has not sent it for you."], action="Review my request", category="follow_up", trigger="Current prepared request not marked sent, 48 hours without activity; once per initial request or follow-up round"),
    _template("insurer_waiting_reminder", "Any update from your insurer?", ["Your case is waiting for an insurer response. If you have received one, add it to Venfour so you can review it alongside your existing evidence.", "If you are still waiting, you can check in with your adjuster. This reminder is based on what you have recorded in Venfour."], action="Open my case", category="follow_up", trigger="Seven days after customer-reported send, no confirmed response; once per round"),
    _template("insurer_no_response_reminder", "Check in on your saved case", ["No insurer response has been recorded in your case yet. If that has changed, add the response or update your case.", "If you are still waiting, consider asking your adjuster for a status update. Venfour cannot determine whether the insurer received your request."], action="Update my case", category="follow_up", trigger="Fourteen days after customer-reported send, no confirmed response; final reminder for that round"),
    _template("response_review_ready", "Your insurer response review is ready", ["The review of the insurer response you added is ready in your private case workspace.", "Open your case to see the explanation and consider the available next steps."], action="Review the response", trigger="Current response-analysis job completed and current result retained; once per job"),
    _template("case_closed", "Your Venfour case has been closed", ["Your case has been closed as you requested. Your retained case history remains available in Venfour.", "Closing your case does not independently confirm an insurer payment or settlement."], action="View my case history", trigger="Customer explicitly confirms resolution; offer acceptance alone does not trigger this"),
)}


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    html: str
    text: str
    version: str = LAYOUT_VERSION


def template_catalogue():
    return [asdict(template) | {"version": LAYOUT_VERSION} for template in TEMPLATES.values()]


def _safe_url(value: str) -> str:
    parsed = urlsplit(value)
    if (parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username
            or parsed.password or any(c in value for c in "\r\n\x00")
            or (parsed.scheme == "http" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"})):
        raise ValueError("Email link is invalid")
    return value


def render_email(key: str, *, action_url: str = "", code: str = "",
                 reply_to: str = "", unsubscribe_url: str = "",
                 preview: bool = False) -> RenderedEmail:
    template = TEMPLATES[key]
    if code and (not code.isascii() or not code.isdigit() or not 6 <= len(code) <= 10):
        raise ValueError("Email code is invalid")
    if action_url:
        _safe_url(action_url)
    if unsubscribe_url:
        _safe_url(unsubscribe_url)
    paragraphs = "".join(f'<p style="margin:0 0 20px;font-size:16px;line-height:1.65;color:#41516a">{escape(p)}</p>' for p in template.paragraphs)
    cta = (f'<p style="margin:30px 0"><a href="{escape(action_url, quote=True)}" style="display:inline-block;background:#234ee6;color:#fff;border-radius:8px;padding:16px 24px;font-size:16px;font-weight:bold;text-decoration:none">{escape(template.action)}</a></p>' if action_url else "")
    code_block = (f'<p style="padding:22px 8px;background:#f0f4fb;border-radius:8px;text-align:center;font-family:monospace;font-size:30px;letter-spacing:4px;color:#172741">{escape(code)}</p><p style="font-size:13px;color:#59687d">This code expires soon. Never share it with anyone.</p>' if code else "")
    footer = "You received this email about your Venfour account or a service you requested."
    if template.category == "follow_up":
        footer = "You opted in to optional follow-up about your case."
    support = f"Questions? Reply to this email ({reply_to})." if reply_to else "Questions? Contact Venfour support."
    unsubscribe = (f'<p><a href="{escape(unsubscribe_url, quote=True)}" style="color:#53647b">Stop optional case reminders</a></p>' if unsubscribe_url else "")
    label = '<p style="color:#97530b;font-size:13px">SAMPLE PREVIEW · Fictional content · No email sent</p>' if preview else ""
    html = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>{escape(template.subject)}</title></head>
<body style="margin:0;background:#f4f6fa;font-family:Arial,Helvetica,sans-serif;color:#172741"><div style="display:none;max-height:0;overflow:hidden">{escape(template.paragraphs[0])}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px"><tr><td style="padding:8px 4px 28px;font-size:25px;font-weight:bold;letter-spacing:-1px">venfour<span style="color:#234ee6">.</span></td></tr>
<tr><td style="background:white;border:1px solid #e3e8f0;border-radius:16px;padding:32px 24px">{label}<p style="font-size:11px;letter-spacing:2px;color:#53647b;margin:0 0 20px">CLARITY FOR YOUR NEXT STEP</p><h1 style="font-size:28px;line-height:1.25;letter-spacing:-.6px;margin:0 0 24px">{escape(template.heading)}</h1>{paragraphs}{code_block}{cta}<p style="font-size:13px;line-height:1.6;color:#59687d;margin:28px 0 0">{escape(support)}</p></td></tr>
<tr><td style="padding:24px 8px;font-size:12px;line-height:1.7;color:#69788c">{escape(footer)}{unsubscribe}<p style="margin-bottom:0">Venfour · Independent vehicle valuation guidance</p></td></tr></table></td></tr></table></body></html>'''
    parts = (["SAMPLE PREVIEW — Fictional content"] if preview else []) + [template.heading, *template.paragraphs]
    if code:
        parts += [code, "This code expires soon. Never share it with anyone."]
    if action_url:
        parts += [f"{template.action}: {action_url}"]
    parts += [support, footer]
    if unsubscribe_url:
        parts += [f"Stop optional case reminders: {unsubscribe_url}"]
    return RenderedEmail(template.subject, html, "\n\n".join(parts))


def render_auth_smtp(context: str) -> str:
    """Compile the shared design to Go templates without changing callback contracts."""
    code = render_email("auth_sign_in", code="123456").html
    code = code.replace("123456", '{{ if eq (len .Token) 6 }}{{ slice .Token 0 3 }}-{{ slice .Token 3 6 }}{{ else }}{{ .Token }}{{ end }}')
    code = code.replace(TEMPLATES["auth_sign_in"].subject,
        '{{ if $signInCode }}Your Venfour sign-in code{{ else }}Your Venfour verification code{{ end }}')
    code = code.replace(escape(TEMPLATES["auth_sign_in"].paragraphs[0]),
        '{{ if $signInCode }}Use this code to sign in to Venfour:{{ else }}Use this code to verify your claim:{{ end }}')
    code = code.replace("This code expires soon. Never share it with anyone.",
        "This code expires soon. If you didn't request it, you can ignore this email.")
    link = render_email("auth_access", action_url="https://example.test/action").html
    link = link.replace("https://example.test/action", '{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=email')
    link = link.replace(TEMPLATES["auth_access"].subject,
        '{{ if $previewReady }}Your Venfour valuation preview is ready{{ else }}Continue your Venfour appraisal{{ end }}')
    link = link.replace(escape(TEMPLATES["auth_access"].paragraphs[0]),
        '{{ if $previewReady }}Your preview is ready. Return to see your result and what to do next.{{ else }}' + escape(TEMPLATES["auth_access"].paragraphs[0]) + '{{ end }}')
    link = link.replace("Continue securely</a>", '{{ if $previewReady }}View my result{{ else }}Continue securely{{ end }}</a>')
    return context + '\n{{ if or $claimCode $signInCode }}\n' + code + '\n      {{ else }}\n' + link + '\n{{ end }}\n'
