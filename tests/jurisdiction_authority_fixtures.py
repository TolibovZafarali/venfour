"""Synthetic local authority fixtures; never packaged operating approvals."""
from datetime import datetime, timedelta, timezone
import hashlib
from uuid import uuid4
from venfour.jurisdiction_authority import canonical, content_digest, authenticator, compile_authority

KEYS = {'review-a': b'a' * 32, 'review-b': b'b' * 32, 'attestation-writer': b'c' * 32}
PUBLISHER = 'authority_fixture_publisher'
WRITER = 'authority_fixture_writer'
NOW = datetime(2026, 9, 22, 12, tzinfo=timezone.utc)


def stamp(now):
    return now.isoformat().replace('+00:00', 'Z')


def manifest(now=NOW):
    entry = lambda identity, key: dict(id=identity,key_id=key,key_digest=hashlib.sha256(KEYS[key]).hexdigest(),
        valid_from=stamp(now-timedelta(days=90)),valid_until=stamp(now+timedelta(days=90)))
    return dict(schema_version='2',revision=1,authorized_reviewers=[entry('review-a','review-a'),entry('review-b','review-b')],
                attestation_writers=[entry(WRITER,'attestation-writer')],publishers=[PUBLISHER])


def source(now=NOW, *, epoch=0, previous_digest=None, config=None, all_capabilities=False):
    cfg = config or manifest(now)
    reviews = [dict(reviewer=k,approved_at=stamp(now-timedelta(minutes=1)),evidence='retained-synthetic-review') for k in ('review-a','review-b')]
    rule = dict(id='synthetic-market',version=1,jurisdictions=['MO'],capability='market_evidence_report',
        claim_type='first_party',policy_use='personal',provider_role='valuation_service',required_facts=['customer_residence'],
        conditions=[],determination='permitted',limitations=[],credential_policy='reviewed_not_required',credentials=[],
        terms_policy='reviewed_not_required',documents=[],date_anchor='service_date',effective_from=(now-timedelta(days=1)).date().isoformat(),
        effective_until=(now+timedelta(days=30)).date().isoformat(),review_due_at=stamp(now+timedelta(days=20)),revocation=None,
        sources=[dict(id='synthetic-source',kind='primary',url='https://regulator.example.test/statute',locator='Section 1(a)',
            document_digest='d'*64,retained_evidence='retained-synthetic-source')],reviews=reviews)
    rules = [rule]
    if all_capabilities:
        rules = [{**rule,'id':'synthetic-'+cap,'capability':cap} for cap in ['market_evidence_report','personalized_valuation','customer_reconsideration_draft','insurer_response_coaching']]
    return dict(schema_version='reviewed-authority-1',revision=epoch+1,previous_epoch=epoch,previous_digest=previous_digest,
        reviewer_revision=cfg['revision'],reviewer_digest=content_digest(canonical(cfg)),prepared_at=stamp(now),request_id=str(uuid4()),
        publisher=PUBLISHER,release='synthetic-local-release',operation='publish',reviews=reviews,rules=rules)


def credential(now=NOW):
    return dict(schema_version='authority-attestation-1',revision=1,config_revision=1,writer=WRITER,request_id=str(uuid4()),
        kind='credential',id='credential-fixture',type='company_license',jurisdiction='MO',holder='entity-fixture',provider='provider-fixture',
        capabilities=['market_evidence_report'],identifier_reference='retained-synthetic-identifier',issuing_authority='synthetic-issuer',
        valid_from=stamp(now-timedelta(days=1)),expires_at=stamp(now+timedelta(days=1)),verified_at=stamp(now),evidence='retained-synthetic-verification',
        status='verified',status_reference='synthetic-verification')


def document(now=NOW):
    return dict(schema_version='authority-attestation-1',revision=1,config_revision=1,writer=WRITER,request_id=str(uuid4()),
        kind='document',id='terms',type='terms',version='synthetic-1',digest='e'*64,status='current',evidence='retained-synthetic-document',verified_at=stamp(now))


def signatures(artifact):
    return [dict(reviewer=key,signature=authenticator(artifact.canonical_json,KEYS[key])) for key in ('review-a','review-b')]


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def install_sql(now=NOW):
    cfg = manifest(now)
    sql = f'create role {PUBLISHER} login; grant jurisdiction_publisher to {PUBLISHER}; create role {WRITER} login; grant jurisdiction_attestor to {WRITER};'
    for key, value in KEYS.items():
        sql += f"insert into jurisdiction_private.review_keys(key_id,secret) values({literal(key)},decode('{value.hex()}','hex'));"
    sql += f"insert into public.jurisdiction_authority_config(revision,canonical_json) values(1,{literal(canonical(cfg))});"
    return sql


def publish_sql(artifact):
    return f"select public.publish_jurisdiction_authority({literal(artifact.canonical_json)},{literal(artifact.digest)},{literal(canonical(signatures(artifact)))}::jsonb);"
