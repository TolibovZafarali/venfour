"""Render the owner-review proposal without creating a signature or sending email."""
from pathlib import Path
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from venfour.analysis_runs import canonical_json_bytes
from venfour.partner_documents import partner_document_path, render_partner_agreement_draft


def draft_payload():
    proposal = json.loads((ROOT / 'venfour/data/referral_partner_agreement_draft.json').read_text())
    snapshot = {**proposal, 'template_version': 1, 'agreement_revision': 1,
                'business_name': 'Partner legal entity entered on the website',
                'legal_business_name': 'To be provided by the authorized partner',
                'address_line1': 'Business address collected before signing', 'address_line2': '',
                'city': 'Business city', 'state': 'Business state', 'postal_code': 'Business postal code',
                'country': 'US', 'contact_name': 'Authorized signer', 'contact_title': 'Signer title or capacity',
                'contact_email': 'Verified account email captured before signing',
                'commission_amount_minor_units': 5000}
    return {'agreement_id': proposal['id'], 'partner_id': 'a7160000-7000-4000-8000-000000000001',
            'bucket': 'partner-agreements',
            'object_path': partner_document_path('a7160000-7000-4000-8000-000000000001', proposal['id']),
            'content_sha256': hashlib.sha256(canonical_json_bytes(snapshot)).hexdigest(), 'snapshot': snapshot}


if __name__ == '__main__':
    output = ROOT / 'output/pdf/referral-partner-agreement-draft.pdf'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(render_partner_agreement_draft(draft_payload()))
    print(output)
