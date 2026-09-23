"""Offline reviewed authority compilation and scoped attestation evaluation.

Compilation is not publication. Independent review authenticators are verified
inside the restricted database publication transaction, never by a staff claim.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import hmac
import json
from pathlib import Path
from typing import Any, Mapping

from jsonschema import Draft202012Validator, FormatChecker, ValidationError

from venfour.jurisdiction import (
    Assertion, Capability, CaseFacts, Registry, _instant, digest, evaluate,
)

SCHEMA_PATH = Path(__file__).resolve().parents[1] / 'schemas/jurisdiction/reviewed-authority-v1.schema.json'


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)


def content_digest(content: str) -> str:
    return hashlib.sha256(content.encode('utf-8')).hexdigest()


def authenticator(content: str, secret: bytes) -> str:
    if len(secret) < 32:
        raise ValueError('Review keys require at least 32 bytes')
    return hmac.new(secret, ('venfour-authority-v1\n' + content).encode(), hashlib.sha256).hexdigest()


def validate_manifest(raw: Mapping[str, Any]) -> None:
    Draft202012Validator(json.loads(SCHEMA_PATH.with_name('reviewer-authority-v2.schema.json').read_text()), format_checker=FormatChecker()).validate(raw)
    if set(raw) != {'schema_version', 'revision', 'authorized_reviewers', 'attestation_writers', 'publishers'} or raw['schema_version'] != '2':
        raise ValueError('Invalid authority configuration')
    if type(raw['revision']) is not int or raw['revision'] < 0:
        raise ValueError('Invalid authority configuration revision')
    identities, keys, digests = set(), set(), set()
    for group in ('authorized_reviewers', 'attestation_writers'):
        if not isinstance(raw[group], list):
            raise ValueError('Invalid authority identities')
        for entry in raw[group]:
            if set(entry) != {'id', 'key_id', 'key_digest', 'valid_from', 'valid_until'}:
                raise ValueError('Invalid authority identity')
            if not all(isinstance(entry[k], str) and 0 < len(entry[k]) <= 128 for k in ('id', 'key_id')):
                raise ValueError('Invalid authority identity')
            if entry['id'] in identities or entry['key_id'] in keys or entry['key_digest'] in digests:
                raise ValueError('Independent authority identities/keys required')
            identities.add(entry['id']); keys.add(entry['key_id']); digests.add(entry['key_digest'])
            if len(entry['key_digest']) != 64 or any(c not in '0123456789abcdef' for c in entry['key_digest']):
                raise ValueError('Invalid key digest')
            if _instant(entry['valid_until']) <= _instant(entry['valid_from']):
                raise ValueError('Invalid authority interval')
    if not isinstance(raw['publishers'], list) or any(not isinstance(v, str) or not v for v in raw['publishers']) or len(set(raw['publishers'])) != len(raw['publishers']):
        raise ValueError('Invalid publishers')


def _reviews(reviews, manifest, now):
    if len(reviews) != 2 or len({r['reviewer'] for r in reviews}) != 2:
        raise ValueError('Two distinct authorized reviews required')
    entries = {r['id']: r for r in manifest['authorized_reviewers']}
    for review in reviews:
        entry = entries.get(review['reviewer'])
        approved = _instant(review['approved_at'])
        if entry is None or not _instant(entry['valid_from']) <= approved <= now < _instant(entry['valid_until']):
            raise ValueError('Reviewer unavailable at approval or publication')


@dataclass(frozen=True)
class AuthorityArtifact:
    canonical_json: str
    digest: str

    @property
    def payload(self) -> dict:
        return json.loads(self.canonical_json)

    @property
    def summary(self) -> str:
        data = self.payload
        rows = [f"Authority revision {data['revision']}; prior epoch {data['previous_epoch']}; {data['operation']}",
                f"Digest: {self.digest}", 'Compilation only; publication requires independent authenticators.']
        rows.extend(f"{r['id']}@{r['version']}: {','.join(r['jurisdictions'])} / {r['capability']} / {r['claim_type']} / {r['policy_use']} / {r['determination']}; review due {r['review_due_at']}" for r in data['rules'])
        return '\n'.join(rows)


def compile_authority(source: Mapping[str, Any], manifest: Mapping[str, Any], *, now: datetime) -> AuthorityArtifact:
    """Validate a complete replacement authority; raw research is never input."""
    if now.tzinfo is None:
        raise ValueError('Aware publication time required')
    Draft202012Validator(json.loads(SCHEMA_PATH.read_text()), format_checker=FormatChecker()).validate(source)
    validate_manifest(manifest)
    if source['reviewer_revision'] != manifest['revision'] or source['reviewer_digest'] != content_digest(canonical(manifest)):
        raise ValueError('Stale reviewer authority')
    if source['publisher'] not in manifest['publishers']:
        raise ValueError('Restricted publisher required')
    if source['revision'] != source['previous_epoch'] + 1 or ((source['previous_epoch'] == 0) != (source['previous_digest'] is None)):
        raise ValueError('Invalid authority lineage')
    prepared = _instant(source['prepared_at'])
    if prepared > now:
        raise ValueError('Future prepared time')
    _reviews(source['reviews'], manifest, now)
    identities = set()
    for rule in source['rules']:
        if rule['id'] in identities:
            raise ValueError('Only one current version per rule identity')
        identities.add(rule['id'])
        _reviews(rule['reviews'], manifest, now)
        if {r['reviewer'] for r in rule['reviews']} != {r['reviewer'] for r in source['reviews']}:
            raise ValueError('Whole artifact reviewers must review every rule')
        if any(_instant(r['approved_at']) > prepared for r in rule['reviews'] + source['reviews']):
            raise ValueError('Artifact predates approval')
        if _instant(rule['review_due_at']) <= now:
            raise ValueError('Review deadline expired')
        if rule['date_anchor'] == 'service_date' and rule['effective_from'] >= _instant(rule['review_due_at']).date().isoformat():
            raise ValueError('Review deadline must cover the service effective date')
        if rule['effective_until'] is not None and rule['effective_until'] <= rule['effective_from']:
            raise ValueError('Invalid effective interval')
        if rule['credential_policy'] == 'required' and not rule['credentials']:
            raise ValueError('Missing credential requirements')
        if rule['terms_policy'] == 'required' and not rule['documents']:
            raise ValueError('Missing disclosure requirements')
        if rule['credential_policy'] == 'reviewed_not_required' and rule['credentials'] or rule['terms_policy'] == 'reviewed_not_required' and rule['documents']:
            raise ValueError('Contradictory requirement policy')
        if rule['determination'] == 'limited' and not (rule['conditions'] or rule['credentials'] or rule['documents']):
            raise ValueError('Limited permission requires implemented restrictions')
        if len({d['type'] for d in rule['documents']}) != len(rule['documents']) or len({c['id'] for c in rule['credentials']}) != len(rule['credentials']):
            raise ValueError('Conflicting requirements')
        for condition in rule['conditions']:
            Assertion(condition['field'], condition['equals'], 'staff', 'reviewed-condition', source['prepared_at'])
        if rule['revocation'] is not None:
            revocation = rule['revocation']
            if revocation['by'] not in {r['reviewer'] for r in source['reviews']} or not max(_instant(r['approved_at']) for r in rule['reviews']) <= _instant(revocation['at']) <= prepared:
                raise ValueError('Invalid reviewed revocation')
    for index, left in enumerate(source['rules']):
        for right in source['rules'][index + 1:]:
            # Deliberately conservative: different anchors or typed conditions do
            # not establish precedence. Split disjoint date intervals explicitly.
            same_scope = all(left[k] == right[k] for k in ('capability', 'claim_type', 'policy_use', 'provider_role')) and set(left['jurisdictions']) == set(right['jurisdictions'])
            overlap = max(left['effective_from'], right['effective_from']) < min(left['effective_until'] or '9999-12-31', right['effective_until'] or '9999-12-31')
            if same_scope and (overlap or left['date_anchor'] != right['date_anchor']):
                raise ValueError('Overlapping rules have no implemented precedence')
    if source['operation'] == 'revoke' and not any(r['revocation'] is not None for r in source['rules']):
        raise ValueError('Revocation must retain a revoked rule version')
    result = canonical(source)
    return AuthorityArtifact(result, content_digest(result))


def verify_artifact(content: str, expected_digest: str, manifest: Mapping[str, Any], *, now: datetime) -> AuthorityArtifact:
    if content_digest(content) != expected_digest:
        raise ValueError('Artifact digest mismatch')
    artifact = compile_authority(json.loads(content), manifest, now=now)
    if content != artifact.canonical_json:
        raise ValueError('Artifact must be canonically serialized')
    return artifact


def _registry(artifact: AuthorityArtifact) -> Registry:
    """Reuse the deterministic Phase 1 scope/claim/date matching contract."""
    scopes, rules = [], []
    for r in artifact.payload['rules']:
        reviews = sorted(r['reviews'], key=lambda v: v['approved_at'])
        scopes.append(dict(id=r['id'], version=r['version'], capability=r['capability'],
            candidate_jurisdictions=r['jurisdictions'], claim_type=r['claim_type'], policy_use=r['policy_use'],
            provider_role=r['provider_role'], required_facts=r['required_facts'], date_anchor=r['date_anchor'],
            review_evidence=reviews[0]['evidence'], reviewed_by=reviews[0]['reviewer'], reviewed_at=reviews[0]['approved_at'],
            source_ids=[s['id'] for s in r['sources']], assumptions=[]))
        rules.append(dict(id=r['id'], version=r['version'], applicability_id=r['id'], applicability_version=r['version'],
            determination=r['determination'], effective_from=r['effective_from'], effective_until=r['effective_until'],
            approved_by=reviews[1]['reviewer'], approved_at=reviews[1]['approved_at'], approval_evidence=reviews[1]['evidence'],
            review_due_at=r['review_due_at'], revoked_at=r['revocation']['at'] if r['revocation'] else None,
            required_credential_refs=[digest(c) for c in r['credentials']], required_terms=[digest(d) for d in r['documents']], limitations=[]))
    from dataclasses import replace
    registry = Registry.from_dict(dict(schema_version='1', version=str(artifact.payload['revision']), interpretations=scopes, rules=rules),
        authorized_reviewers=frozenset(v['reviewer'] for v in artifact.payload['reviews']),
        source_ids=frozenset(s['id'] for r in artifact.payload['rules'] for s in r['sources']))
    return replace(registry, content_digest=artifact.digest)


def evaluate_attested(*, artifact: AuthorityArtifact, facts: CaseFacts, capability: Capability,
                      bundle: Mapping[str, Any], now: datetime, existing_eligible: bool):
    """Only database-verified immutable attestations enter this runtime seam.

    No caller-supplied flat credential IDs or legacy version labels can satisfy
    a reviewed requirement. SQL independently checks these at every mutation.
    """
    from dataclasses import replace
    credentials, terms, extra = set(), set(), set()
    if bundle['authority_context']['registry_digest'] != artifact.digest or bundle['authority_context']['epoch'] != artifact.payload['revision']:
        extra.add('STALE_AUTHORITY')
    for rule in artifact.payload['rules']:
        from venfour.jurisdiction import resolve
        if (rule['capability'] != capability.value or set(rule['jurisdictions']) != set(resolve(facts).candidates)
            or any(facts.known(k) != rule[k] for k in ('claim_type', 'policy_use', 'provider_role'))):
            continue
        anchor = now.astimezone(timezone.utc).date().isoformat() if rule['date_anchor'] == 'service_date' else facts.known(rule['date_anchor'])
        if anchor is None or anchor < rule['effective_from'] or (rule['effective_until'] and anchor >= rule['effective_until']):
            continue
        if any(facts.known(c['field']) != c['equals'] for c in rule['conditions']):
            extra.add('APPLICABILITY_CONDITION_UNMET')
        for requirement in rule['credentials']:
            matches = [c for c in bundle['credentials'] if c['id'] == requirement['id']]
            if len(matches) != 1:
                continue
            cred = matches[0]
            if (all(cred.get(k) == v for k, v in requirement.items()) and
                cred.get('status') == 'verified' and cred['config_revision'] == bundle['authority_context']['config_revision'] and
                facts.known('assigned_credential_ref') == cred['id'] and capability.value in cred['capabilities'] and
                _instant(cred['valid_from']) <= now < _instant(cred['expires_at']) and _instant(cred['verified_at']) <= now):
                credentials.add(digest(requirement))
        for requirement in rule['documents']:
            documents = [d for d in bundle['documents'] if d['type'] == requirement['type']]
            if len(documents) != 1 or documents[0]['status'] != 'current' or documents[0]['config_revision'] != bundle['authority_context']['config_revision'] or any(documents[0].get(k) != v for k, v in requirement.items()):
                continue
            if any(all(a.get(k) == v for k, v in requirement.items()) and a['customer_id'] == bundle['customer_id'] and
                   a['case_id'] == bundle['case_id'] and a['order_id'] == bundle['order_id'] and _instant(a['accepted_at']) <= now
                   for a in bundle['acceptances']):
                terms.add(digest(requirement))
    decision = evaluate(facts, capability, _registry(artifact), evaluated_at=now, existing_eligible=existing_eligible,
                        verified_credentials=frozenset(credentials), ready_terms=frozenset(terms))
    reasons = tuple(sorted(set(decision.reasons) | extra))
    return replace(decision, proposed_allowed=not reasons, reasons=reasons)


def validate_attestation(source: Mapping[str, Any], manifest: Mapping[str, Any], *, now: datetime) -> str:
    schema = SCHEMA_PATH.with_name('authority-attestation-v1.schema.json')
    Draft202012Validator(json.loads(schema.read_text()), format_checker=FormatChecker()).validate(source)
    validate_manifest(manifest)
    writer = next((r for r in manifest['attestation_writers'] if r['id'] == source['writer']), None)
    if writer is None or source['config_revision'] != manifest['revision'] or not _instant(writer['valid_from']) <= _instant(source['verified_at']) <= now < _instant(writer['valid_until']):
        raise ValueError('Current authorized attestation writer required')
    if source['kind'] == 'credential':
        if _instant(source['expires_at']) <= _instant(source['valid_from']) or (source['status'] == 'verified' and _instant(source['expires_at']) <= now):
            raise ValueError('Invalid credential interval')
    elif source['id'] != source['type']:
        raise ValueError('Document identity must match its type')
    return canonical(source)


def attested_snapshot(*, case_id: str, facts: CaseFacts, facts_revision: int, bundle: Mapping[str, Any], now: datetime):
    from dataclasses import asdict
    from venfour.jurisdiction import load_packaged_registry
    from venfour.jurisdiction_adapter import BOUNDARIES, DecisionSnapshot, decide
    registry = load_packaged_registry()
    snapshot = decide(case_id=case_id, facts=facts, facts_revision=facts_revision, boundary='checkout',
                      registry=registry, evaluated_at=now, existing_eligible=True)
    payload = snapshot.to_dict()
    payload['authority_context'] = bundle['authority_context']
    if bundle['artifact'] is not None:
        try:
            artifact = verify_artifact(bundle['artifact'], bundle['authority_context']['registry_digest'], bundle['config'], now=now)
            decisions = [evaluate_attested(artifact=artifact, facts=facts, capability=cap, bundle=bundle,
                                          now=now, existing_eligible=True) for cap in BOUNDARIES['checkout']]
            payload['registry_version'] = str(artifact.payload['revision'])
            payload['registry_digest'] = artifact.digest
            payload['decisions'] = [asdict(d) for d in decisions]
            payload['proposed_allowed'] = all(d.proposed_allowed for d in decisions)
        except (ValueError, KeyError, TypeError, ValidationError):
            pass  # Empty registry's explicit missing approval decision remains.
    return DecisionSnapshot(canonical(payload), content_digest(canonical(payload)))
