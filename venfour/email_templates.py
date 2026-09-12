"""Content-only email catalogue; every definition inherits the master design."""

from __future__ import annotations

from dataclasses import asdict, dataclass
import re
from typing import Literal
from urllib.parse import urlsplit

from venfour.email_design import LAYOUT_VERSION, LOGO_PATH, RenderedEmail, render_master


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
    interaction: Literal["link", "code", "code_and_link", "notice"] = "link"
    details: tuple[tuple[str, str], ...] = ()
    attachment: str = ""


def _template(key, subject, body, *, heading=None, action="Open Venfour",
              category="transactional", identity="customer", trigger="", interaction="link", details=(), attachment=""):
    return EmailTemplate(key, subject, heading or subject, tuple(body), action, category, identity, trigger, interaction, tuple(details), attachment)


TEMPLATES = {t.key: t for t in (
    _template(
        "auth_sign_in",
        "Your Venfour sign-in code",
        [
            "Use this code to sign in to Venfour. Enter it only on the page where you requested it.",
            "If you did not request this code, you can ignore this email.",
        ],
        identity="auth",
        interaction="code",
        trigger="Requested email sign-in or signup",
    ),
    _template(
        "auth_claim",
        "Your Venfour verification code",
        [
            "Use this code to verify your email and continue your saved case.",
            "Verification does not purchase a review or send anything to your insurer.",
        ],
        identity="auth",
        interaction="code",
        trigger="Requested checkout claim verification",
    ),
    _template(
        "auth_access",
        "Continue your Venfour appraisal",
        [
            "Use this secure, one-time link to verify your email and return to your saved appraisal.",
            "If the link expires, request a fresh link from the same page. If you did not request access, you can ignore this email.",
        ],
        action="Continue securely",
        identity="auth",
        trigger="Requested case access or preview recovery",
    ),
    _template(
        "auth_preview_ready",
        "Your Venfour valuation preview is ready",
        [
            "Your saved preview is ready. Return to see your result and the available next steps.",
            "If verification expires, request a fresh link from the same page.",
        ],
        action="View my result",
        identity="auth",
        trigger="Existing guest preview completion queue",
    ),
    _template(
        "auth_invite",
        "Your invitation to Venfour",
        [
            "You have been invited to create a Venfour account. Continue securely to review the invitation.",
        ],
        action="Review invitation",
        identity="auth",
        trigger="Supabase administrator account invitation",
    ),
    _template(
        "auth_recovery",
        "Reset your Venfour password",
        [
            "Use this secure link to continue your requested password reset.",
            "If you did not request this, you can ignore this email.",
        ],
        action="Continue securely",
        identity="auth",
        trigger="Supabase password recovery request",
    ),
    _template(
        "auth_email_change",
        "Confirm your Venfour email change",
        [
            "Confirm the email change you requested for your Venfour account.",
            "If you did not request this change, contact Venfour support.",
        ],
        action="Confirm email change",
        identity="auth",
        interaction="code_and_link",
        trigger="Supabase email change; both addresses when secure change is enabled",
    ),
    _template(
        "auth_reauthentication",
        "Confirm it’s you",
        [
            "Use this verification code to confirm the account action you requested.",
            "Do not share this code. Venfour support will never ask for it.",
        ],
        identity="auth",
        interaction="code",
        trigger="Supabase reauthentication",
    ),
    *(_template("auth_" + key, title, ["This security change was recorded on your Venfour account.", "If you did not make this change, contact Venfour support."], identity="auth", interaction="notice", trigger="Optional Supabase security notification; provider toggle controls sending") for key, title in (
        ("password_changed_notification", "Your Venfour password was changed"),
        ("email_changed_notification", "Your Venfour email address was changed"),
        ("phone_changed_notification", "Your Venfour phone number was changed"),
        ("mfa_factor_enrolled_notification", "A verification method was added"),
        ("mfa_factor_unenrolled_notification", "A verification method was removed"),
        ("identity_linked_notification", "A sign-in method was linked"),
        ("identity_unlinked_notification", "A sign-in method was removed"),
    )),
    _template(
        "partner_invitation",
        "Your invitation to become a Venfour referral partner",
        [
            "Venfour has invited your business to join its referral partner program.",
            "Verify your email, complete your business details, and review the agreement before deciding whether to sign.",
            "This invitation expires seven days after it was issued. Opening the link does not accept the invitation or sign an agreement.",
        ],
        action="Review invitation",
        identity="partner",
        trigger="Authorized manager invitation or replacement invitation",
    ),
    _template(
        "partner_agreement_copy",
        "Your completed Venfour referral partner agreement",
        [
            "Your completed referral partner agreement is attached. This is the same retained PDF available in your Venfour partner dashboard.",
            "Your onboarding is complete. Open your partner workspace to share your referral link and follow your referral activity.",
        ],
        action="Open partner workspace",
        identity="partner",
        trigger="Retained countersigned PDF ready or explicit additional copy",
        attachment="Signed referral partner agreement (PDF)",
    ),
    _template(
        "intake_reminder",
        "Your saved Venfour review is here",
        [
            "You can return to the details you have already saved whenever you are ready.",
            "Check your information and continue from where you left off.",
        ],
        action="Continue my review",
        category="follow_up",
        trigger="Unfinished intake, 24 hours without activity; once per case",
    ),
    _template(
        "free_review_ready",
        "Your Venfour review is ready",
        [
            "Your saved review is ready. Open Venfour to see what the evidence supports and what to do next.",
        ],
        action="View my review",
        trigger="Current completed free analysis for a verified owner; existing guest-origin notification excluded",
    ),
    _template(
        "free_review_reminder",
        "Return to your saved review",
        [
            "Your review is saved in Venfour. You can return to your result and consider your next step whenever you are ready.",
            "No action is required if you have everything you need.",
        ],
        action="View my review",
        category="follow_up",
        trigger="Free review complete, no purchase and no activity for 72 hours; once per case, no sales promotion",
    ),
    _template(
        "paid_review_started",
        "Your Venfour review is underway",
        [
            "Your purchase has been confirmed and your detailed review is being prepared.",
            "You can return to your case to check progress. We will let you know when the review is ready.",
        ],
        action="View my case",
        trigger="Server-confirmed paid order and active entitlement; five-minute coalescing window",
    ),
    _template(
        "paid_review_ready",
        "Your detailed Venfour review is ready",
        [
            "Your report and supporting explanation are ready in your private case workspace.",
            "Review the evidence and the available next steps before deciding what to share with your adjuster.",
        ],
        action="View my review",
        trigger="Current report published and accessible under existing report-access contract",
    ),
    _template(
        "request_reminder",
        "Your prepared request is saved",
        [
            "Your request is prepared in Venfour. Review it, attach the supporting report, and send it from your own email account when you are ready.",
            "If you have already sent it, record that in your case to keep your progress up to date. Venfour has not sent it for you.",
        ],
        action="Review my request",
        category="follow_up",
        trigger="Current prepared request not marked sent, 48 hours without activity; once per initial request or follow-up round",
    ),
    _template(
        "insurer_waiting_reminder",
        "Any update from your insurer?",
        [
            "Your case is waiting for an insurer response. If you have received one, add it to Venfour so you can review it alongside your existing evidence.",
            "If you are still waiting, you can check in with your adjuster. This reminder is based on what you have recorded in Venfour.",
        ],
        action="Open my case",
        category="follow_up",
        trigger="Seven days after customer-reported send, no confirmed response; once per round",
    ),
    _template(
        "insurer_no_response_reminder",
        "Check in on your saved case",
        [
            "No insurer response has been recorded in your case yet. If that has changed, add the response or update your case.",
            "If you are still waiting, consider asking your adjuster for a status update. Venfour cannot determine whether the insurer received your request.",
        ],
        action="Update my case",
        category="follow_up",
        trigger="Fourteen days after customer-reported send, no confirmed response; final reminder for that round",
    ),
    _template(
        "response_review_ready",
        "Your insurer response review is ready",
        [
            "The review of the insurer response you added is ready in your private case workspace.",
            "Open your case to see the explanation and consider the available next steps.",
        ],
        action="Review the response",
        trigger="Current response-analysis job completed and current result retained; once per job",
    ),
    _template(
        "case_closed",
        "Your Venfour case has been closed",
        [
            "Your case has been closed as you requested. Your retained case history remains available in Venfour.",
            "Closing your case does not independently confirm an insurer payment or settlement.",
        ],
        action="View my case history",
        trigger="Customer explicitly confirms resolution; offer acceptance alone does not trigger this",
    ),
)}


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
                 brand_origin: str = "https://venfour.com") -> RenderedEmail:
    template = TEMPLATES[key]
    _safe_url(brand_origin)
    origin_parts = urlsplit(brand_origin)
    if origin_parts.path not in {"", "/"} or origin_parts.query or origin_parts.fragment:
        raise ValueError("Email brand origin is invalid")
    if code and (not code.isascii() or not code.isdigit() or not 6 <= len(code) <= 10):
        raise ValueError("Email code is invalid")
    if action_url:
        _safe_url(action_url)
    if unsubscribe_url:
        _safe_url(unsubscribe_url)
    # Content contracts prevent accidental links in code-only and security notices.
    if (code and template.interaction not in {"code", "code_and_link"}) or (
        action_url and template.interaction not in {"link", "code_and_link"}
    ):
        raise ValueError("Email content does not match its interaction")
    if unsubscribe_url and template.category != "follow_up":
        raise ValueError("Only optional follow-ups include unsubscribe links")
    display_code = code[:3] + "-" + code[3:] if len(code) == 6 else code
    return render_master(subject=template.subject, heading=template.heading,
        paragraphs=template.paragraphs, action=template.action, action_url=action_url,
        code=display_code, reply_to=reply_to, optional=template.category == "follow_up",
        unsubscribe_url=unsubscribe_url, details=template.details, brand_origin=brand_origin.rstrip('/'))


def render_preview(key: str, *, reply_to: str = "", brand_origin: str = "https://venfour.com") -> RenderedEmail:
    """Exact delivery renderer with inert sample values; labels belong outside the email."""
    template = TEMPLATES[key]
    return render_email(key,
        action_url="https://example.test/preview" if template.interaction in {"link", "code_and_link"} else "",
        code="123456" if template.interaction in {"code", "code_and_link"} else "",
        reply_to=reply_to,
        brand_origin=brand_origin,
        unsubscribe_url="https://example.test/preferences" if template.category == "follow_up" else "")


def render_auth_smtp_template(key: str, *, case_link: bool = False) -> str:
    """SMTP only supplies token/link values; content and styling stay in the catalogue."""
    token = "{{ if eq (len .Token) 6 }}{{ slice .Token 0 3 }}-{{ slice .Token 3 6 }}{{ else }}{{ .Token }}{{ end }}"
    template = TEMPLATES[key]
    rendered = render_email(key,
        brand_origin="https://example.test",
        code="9876543210" if template.interaction in {"code", "code_and_link"} else "",
        action_url="https://example.test/smtp-action" if template.interaction in {"link", "code_and_link"} else "")
    url = '{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=email' if case_link else '{{ .ConfirmationURL }}'
    return (rendered.html.replace("9876543210", token).replace("https://example.test/smtp-action", url)
            .replace("https://example.test" + LOGO_PATH, '{{ .SiteURL }}' + LOGO_PATH))


def render_auth_smtp_subject(context: str) -> str:
    selectors = re.sub(r"}}\s+{{", "}}{{", context.strip())
    return (selectors + '{{ if $signInCode }}' + TEMPLATES['auth_sign_in'].subject
            + '{{ else if $claimCode }}' + TEMPLATES['auth_claim'].subject
            + '{{ else if $previewReady }}' + TEMPLATES['auth_preview_ready'].subject
            + '{{ else }}' + TEMPLATES['auth_access'].subject + '{{ end }}')


def render_auth_smtp(context: str) -> str:
    """Preserve the existing sign-in/claim selectors for signup and magic-link SMTP."""
    return (context + '\n{{ if or $claimCode $signInCode }}\n{{ if $signInCode }}\n'
            + render_auth_smtp_template("auth_sign_in") + '\n{{ else }}\n' + render_auth_smtp_template("auth_claim") + '\n{{ end }}'
            + '\n      {{ else }}\n{{ if $previewReady }}\n' + render_auth_smtp_template("auth_preview_ready", case_link=True)
            + '\n{{ else }}\n' + render_auth_smtp_template("auth_access", case_link=True) + '\n{{ end }}\n{{ end }}\n')


def smtp_templates(context: str):
    """Provider template slots, all generated from the same content catalogue."""
    subject, html = render_auth_smtp_subject(context), render_auth_smtp(context)
    entries = {name: {"section": 'auth.email.template.' + name.replace('-', '_'), "subject": subject, "html": html}
               for name in ('confirmation', 'magic-link')}
    for key, template in TEMPLATES.items():
        if template.identity != 'auth' or key in {'auth_sign_in', 'auth_claim', 'auth_access', 'auth_preview_ready'}:
            continue
        name = key.removeprefix('auth_')
        section = ('auth.email.notification.' + name.removesuffix('_notification')
                   if template.interaction == 'notice' else 'auth.email.template.' + name)
        entries[name] = {"section": section, "subject": template.subject, "html": render_auth_smtp_template(key)}
    for entry in entries.values():
        entry['html'] = '<!-- Generated by scripts/preview_emails.py; edit the shared catalogue and master design. -->\n' + entry['html']
    return entries
