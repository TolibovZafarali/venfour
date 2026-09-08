"""Render retained partner agreements from immutable signing records."""

from __future__ import annotations

import hashlib
import hmac
import html
import io
import re
from collections.abc import Mapping
from datetime import datetime
from functools import lru_cache
from threading import RLock
from typing import Any
from uuid import UUID

import pymupdf
from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer

from venfour.analysis_runs import canonical_json_bytes


PARTNER_DOCUMENT_BUCKET = "partner-agreements"
PARTNER_DOCUMENT_FILENAME = "Venfour_Referral_Partner_Agreement.pdf"
MAX_PARTNER_DOCUMENT_BYTES = 10 * 1024 * 1024
_FONT_NAME = "PartnerAgreementUnicode"
_RENDER_LOCK = RLock()


class PartnerDocumentError(ValueError):
    """The immutable document cannot be safely rendered or verified."""


def canonical_uuid(value: Any) -> str:
    if not isinstance(value, str):
        raise PartnerDocumentError("Record identity is invalid")
    try:
        result = str(UUID(value))
    except ValueError as exc:
        raise PartnerDocumentError("Record identity is invalid") from exc
    if result != value:
        raise PartnerDocumentError("Record identity is invalid")
    return result


def partner_document_path(partner_id: str, agreement_id: str) -> str:
    return (
        f"partners/{canonical_uuid(partner_id)}/agreements/"
        f"{canonical_uuid(agreement_id)}/signed.pdf"
    )


def document_sha256(content: bytes) -> str:
    if not isinstance(content, bytes) or not content.startswith(b"%PDF-"):
        raise PartnerDocumentError("Agreement document is invalid")
    if not 0 < len(content) <= MAX_PARTNER_DOCUMENT_BYTES:
        raise PartnerDocumentError("Agreement document size is invalid")
    return hashlib.sha256(content).hexdigest()


def validated_digest(value: Any) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise PartnerDocumentError("Agreement digest is invalid")
    return value


def _text(value: Any, *, optional: bool = False, maximum: int = 200_000) -> str:
    if optional and value is None:
        return ""
    if not isinstance(value, str) or len(value) > maximum:
        raise PartnerDocumentError("Agreement text is invalid")
    if not optional and not value.strip():
        raise PartnerDocumentError("Agreement text is incomplete")
    if any(ord(char) < 32 and char not in "\n\r\t" for char in value):
        raise PartnerDocumentError("Agreement text contains unsupported characters")
    return value


@lru_cache(maxsize=1)
def _font() -> TTFont:
    # The existing document dependency bundles this Unicode TrueType font.
    font = TTFont(_FONT_NAME, io.BytesIO(pymupdf.Font("cjk").buffer))
    pdfmetrics.registerFont(font)
    return font


def _markup(value: str) -> str:
    supported = _font().face.charToGlyph
    if any(ord(char) not in supported for char in value if char not in "\n\r\t"):
        raise PartnerDocumentError("Agreement text requires an unsupported font glyph")
    # Plain agreement text is never interpreted as ReportLab's markup language.
    return html.escape(value).replace("\r\n", "\n").replace("\r", "\n").replace("\n", "<br/>").replace("\t", "    ")


class _RetainedCanvas(Canvas):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        kwargs["invariant"] = 1
        super().__init__(*args, **kwargs)


def _signature(value: Any, *, partner: bool) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise PartnerDocumentError("Both signature records are required")
    canonical_uuid(value.get("user_id"))
    for key in ("typed_legal_name", "typed_title", "verified_email"):
        _text(value.get(key), maximum=320)
    timestamp = _text(value.get("signed_at"), maximum=80)
    try:
        parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError("Missing timezone")
    except ValueError as exc:
        raise PartnerDocumentError("Signature timestamp is invalid") from exc
    required = ("electronic_consent", "authority_confirmed")
    if partner:
        required += ("pdf_email_consent",)
    if any(value.get(key) is not True for key in required):
        raise PartnerDocumentError("Signature acknowledgements are incomplete")
    return value


def render_partner_agreement(payload: Mapping[str, Any]) -> bytes:
    """Produce repeatable bytes without looking up mutable business or template data."""
    # ReportLab shares registered font state across document instances.
    with _RENDER_LOCK:
        return _render_partner_agreement(payload)


def _render_partner_agreement(payload: Mapping[str, Any]) -> bytes:
    agreement_id = canonical_uuid(payload.get("agreement_id"))
    partner_id = canonical_uuid(payload.get("partner_id"))
    expected_path = partner_document_path(partner_id, agreement_id)
    if payload.get("bucket") != PARTNER_DOCUMENT_BUCKET or payload.get("object_path") != expected_path:
        raise PartnerDocumentError("Agreement artifact identity is invalid")
    digest = validated_digest(payload.get("content_sha256"))
    snapshot = payload.get("snapshot")
    if not isinstance(snapshot, Mapping):
        raise PartnerDocumentError("The retained agreement is missing")
    if not hmac.compare_digest(hashlib.sha256(canonical_json_bytes(snapshot)).hexdigest(), digest):
        raise PartnerDocumentError("The retained agreement does not match its signed digest")
    partner_signature = _signature(payload.get("partner_signature"), partner=True)
    manager_signature = _signature(payload.get("manager_signature"), partner=False)
    if partner_signature["verified_email"] != snapshot.get("contact_email"):
        raise PartnerDocumentError("Partner signature does not match the agreement")
    amount = snapshot.get("commission_amount_minor_units")
    if isinstance(amount, bool) or not isinstance(amount, int) or amount <= 0 or snapshot.get("currency") != "USD":
        raise PartnerDocumentError("Commission terms are invalid")
    sections = snapshot.get("sections")
    if not isinstance(sections, list) or not 1 <= len(sections) <= 100:
        raise PartnerDocumentError("Agreement sections are invalid")
    template_version = snapshot.get("template_version")
    if isinstance(template_version, bool) or not isinstance(template_version, int) or template_version < 1:
        raise PartnerDocumentError("Template version is invalid")
    revision = snapshot.get("agreement_revision", payload.get("agreement_revision"))
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
        raise PartnerDocumentError("Agreement revision is invalid")

    _font()
    body = ParagraphStyle("body", fontName=_FONT_NAME, fontSize=10, leading=15, spaceAfter=9,
                          textColor=colors.HexColor("#233044"), splitLongWords=True)
    heading = ParagraphStyle("heading", parent=body, fontSize=13, leading=18,
                             spaceBefore=15, spaceAfter=8, keepWithNext=True,
                             textColor=colors.HexColor("#16263d"))
    title = ParagraphStyle("title", parent=heading, fontSize=22, leading=28, spaceBefore=12,
                           spaceAfter=20)
    small = ParagraphStyle("small", parent=body, fontSize=8, leading=12, spaceAfter=5)
    story: list[Any] = []

    def paragraph(value: str, style: ParagraphStyle = body) -> None:
        story.append(Paragraph(_markup(value), style))

    def field(label: str, value: Any, *, optional: bool = False) -> None:
        retained = _text(value, optional=optional)
        if retained:
            paragraph(f"{label}: {retained}")

    paragraph("VENFOUR", small)
    paragraph(_text(snapshot.get("title"), maximum=300), title)
    paragraph("Completed referral partner agreement", body)
    paragraph(f"Agreement {agreement_id}", small)
    paragraph(f"Published template version {template_version} | Agreement revision {revision}", small)
    paragraph("Business and commission terms", heading)
    for label, key in (
        ("Business", "business_name"), ("Legal business name", "legal_business_name"),
        ("Address", "address_line1"), ("Address line 2", "address_line2"),
        ("City", "city"), ("State", "state"), ("Postal code", "postal_code"),
        ("Country", "country"), ("Contact", "contact_name"),
        ("Contact title", "contact_title"), ("Verified contact email", "contact_email"),
    ):
        field(label, snapshot.get(key), optional=key == "address_line2")
    paragraph(f"Fixed commission per qualifying purchase: USD {amount // 100:,}.{amount % 100:02d}")
    for section in sections:
        if not isinstance(section, Mapping):
            raise PartnerDocumentError("Agreement section is invalid")
        paragraph(_text(section.get("heading"), maximum=300), heading)
        # Separate plain paragraphs allow arbitrarily long sections to span pages.
        section_body = _text(section.get("body"))
        for block in re.split(r"(?:\r?\n){2,}", section_body):
            if block:
                paragraph(block)
    signing_statement = snapshot.get("signing_statement")
    if signing_statement:
        paragraph("Signing statement", heading)
        paragraph(_text(signing_statement))
    if snapshot.get("execution_terms"):
        paragraph("Execution terms", heading)
        paragraph(_text(snapshot["execution_terms"]))
    signatures_start = len(story)
    paragraph("Electronic signatures", heading)
    for label, signature, is_partner in (
        ("For the partner", partner_signature, True),
        ("For Venfour", manager_signature, False),
    ):
        signature_start = signatures_start if is_partner else len(story)
        paragraph(label, heading)
        field("Signed by", signature["typed_legal_name"])
        field("Title", signature["typed_title"])
        field("Verified email", signature["verified_email"])
        field("Signed at", signature["signed_at"])
        paragraph("Electronic records and signatures: agreed", small)
        paragraph("Authority to sign: confirmed", small)
        if is_partner:
            paragraph("Agreement PDF by email: agreed", small)
        paragraph(f"Authenticated account: {signature['user_id']}", small)
        story[signature_start:] = [KeepTogether(story[signature_start:])]
    story.append(Spacer(1, 14))
    paragraph("Retained agreement content SHA-256", small)
    paragraph(digest, small)

    output = io.BytesIO()
    document = SimpleDocTemplate(output, pagesize=LETTER, rightMargin=54, leftMargin=54,
                                 topMargin=45, bottomMargin=52, title="Venfour Referral Partner Agreement",
                                 author="Venfour", pageCompression=1)

    def page_footer(canvas: Canvas, doc: SimpleDocTemplate) -> None:
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor("#d7dde6"))
        canvas.line(54, 38, LETTER[0] - 54, 38)
        canvas.setFont(_FONT_NAME, 8)
        canvas.setFillColor(colors.HexColor("#526175"))
        canvas.drawString(54, 25, "Venfour | Retained agreement")
        canvas.drawRightString(LETTER[0] - 54, 25, f"Page {doc.page}")
        canvas.restoreState()

    try:
        document.build(story, onFirstPage=page_footer, onLaterPages=page_footer,
                       canvasmaker=_RetainedCanvas)
    except PartnerDocumentError:
        raise
    except Exception as exc:
        raise PartnerDocumentError("Agreement PDF could not be prepared") from exc
    content = output.getvalue()
    document_sha256(content)
    return content
