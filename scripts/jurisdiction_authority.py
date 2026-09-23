"""Restricted offline review and explicit publication tooling; no implicit I/O."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from venfour.jurisdiction_authority import (  # noqa: E402
    canonical, compile_authority, authenticator,
    validate_attestation,
)


def read_json(path):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate JSON key')
            result[key] = value
        return result
    return json.loads(Path(path).read_text(), object_pairs_hook=pairs)


def secret_file(path):
    file = Path(path)
    if file.stat().st_mode & 0o077:
        raise ValueError('Signing key file must be private (mode 0600)')
    secret = bytes.fromhex(file.read_text().strip())
    if len(secret) < 32:
        raise ValueError('Signing keys require at least 32 bytes')
    return secret


def sql_literal(value):
    return "'" + value.replace("'", "''") + "'"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['dry-run', 'sign', 'publish', 'revoke', 'attest', 'sign-attestation'])
    parser.add_argument('--source', required=True, help='Reviewed source JSON, never the research seed')
    parser.add_argument('--manifest', default=str(ROOT / 'venfour/data/jurisdiction_reviewers.json'))
    parser.add_argument('--output', help='Canonical artifact, summary or signature output')
    parser.add_argument('--reviewer')
    parser.add_argument('--key-file', help='Private hex signing key, never a command-line secret')
    parser.add_argument('--signatures', help='JSON array of two independent review signatures')
    parser.add_argument('--signature-file', help='Attestation signature JSON')
    parser.add_argument('--service', help='Explicit psql service; credentials remain in protected service/password files')
    args = parser.parse_args()
    now = datetime.now(timezone.utc)
    source, manifest = read_json(args.source), read_json(args.manifest)
    attesting = args.operation in {'attest', 'sign-attestation'}
    if attesting:
        content = validate_attestation(source, manifest, now=now)
    else:
        artifact = compile_authority(source, manifest, now=now)
        content = artifact.canonical_json
    if args.operation == 'dry-run':
        print(artifact.summary)
        if args.output:
            Path(args.output).write_text(content)
            Path(args.output + '.summary.txt').write_text(artifact.summary + '\n')
        return
    if args.operation in {'sign', 'sign-attestation'}:
        if not args.key_file or not args.output:
            parser.error('Signing requires --key-file and --output')
        group = 'attestation_writers' if attesting else 'authorized_reviewers'
        signer = source['writer'] if attesting else args.reviewer
        if not attesting and signer not in {r['reviewer'] for r in source['reviews']}:
            raise ValueError('Signer must be one of the two reviewed identities')
        entry = next((r for r in manifest[group] if r['id'] == signer), None)
        key = secret_file(args.key_file)
        if entry is None or hashlib.sha256(key).hexdigest() != entry['key_digest']:
            raise ValueError('Signing key does not match restricted authority')
        signature = (hmac.new(key, ('venfour-attestation-v1\n' + content).encode(), hashlib.sha256).hexdigest()
                     if attesting else authenticator(content, key))
        Path(args.output).write_text(canonical({'reviewer': signer, 'signature': signature}) + '\n')
        return
    if not args.service:
        parser.error('Publication requires an explicit --service; no default database target')
    if args.operation == 'revoke' and source['operation'] != 'revoke' or args.operation == 'publish' and source['operation'] != 'publish':
        raise ValueError('Publication operation mismatch')
    if attesting:
        if not args.signature_file:
            parser.error('Attestation requires --signature-file')
        signature = read_json(args.signature_file)
        if signature['reviewer'] != source['writer']:
            raise ValueError('Attestation signer mismatch')
        statement = f"select public.publish_jurisdiction_attestation({sql_literal(content)},{sql_literal(signature['signature'])});"
    else:
        if not args.signatures:
            parser.error('Publication requires --signatures')
        signatures = read_json(args.signatures)
        statement = f"select public.publish_jurisdiction_authority({sql_literal(content)},{sql_literal(artifact.digest)},{sql_literal(canonical(signatures))}::jsonb);"
    # Only explicit publish/revoke/attest invokes psql. No API, provider, email,
    # network library, environment credential printing, or default connection.
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    env['PGSERVICE'] = args.service
    subprocess.run(['psql', '-X', '--no-password', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
                   input='begin;\nset local standard_conforming_strings=on;\n' + statement + '\ncommit;\n', text=True, check=True, env=env)


if __name__ == '__main__':
    main()
