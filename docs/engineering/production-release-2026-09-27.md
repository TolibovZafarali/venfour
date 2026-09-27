# Production release — September 27, 2026

The public site and customer/partner application run source
`aad893149b45eae14b7a8173f093388a4f1e9558` at 100% traffic. Deployment completed
at 06:46 UTC. Both versions carry tag `release-0927-aad8931`.

| Component | Previous version / rollback target | Released version |
| --- | --- | --- |
| Public site | `a27cb0a7-c90f-42e2-84dd-ee87890f624d` | `b166f612-2e78-419c-abf6-68b2fc8bb942` |
| Customer and partner application | `b2fd53d6-9d92-4dbe-aa74-a6ca7eb63ece` | `5642770b-7704-4180-b69f-8f0bf3be9e63` |

## Scope

The release includes 51 state guides, 24 insurer guides and their directory,
pricing and sample-report pages, the fictional sample PDF, public layout and
navigation updates, and separate embedded sign-in and OAuth routes. The
application was deployed first so its sign-in routes were available before the
public site changed. Existing production variables were preserved.

All 196 changed paths since the verified deployed baseline `64e8aa5` were
inventoried: 116 frontend runtime paths, one edge runtime path, one public asset,
26 frontend test/tooling paths, 10 documentation paths, and 42 repository
artifacts. There are no backend or migration changes in this delta; neither
required deployment. This release does not change payment or provider settings.

Release preparation corrected state-navigation tests to await asynchronous route
loading and rendered content. The first selected run passed 1,037 tests and
failed three premature assertions. The complete selected rerun passed all 1,040
tests after the test-only correction. Runtime code was unchanged by that repair.

## Verification

- 1,040 selected frontend, authentication, routing, Worker, and environment tests
  passed across 29 files.
- 117 state-guide and 60 insurer-guide browser checks passed on desktop and
  small-phone profiles; five profile-specific checks were intentionally skipped.
- Changed-source lint passed for 123 files; the repaired test also passed lint.
- Both production builds passed environment validation, contract freshness,
  TypeScript, and packaging dry runs. Builds retained the large-chunk advisory.
- Built assets passed a credential-pattern scan.
- Live deployment status confirmed 100% traffic to both released versions.
- 130 live HTTP checks passed, including all state/insurer pages, metadata,
  backend health/readiness, unauthenticated API refusal, host isolation, Access
  redirects, and embedded sign-in/OAuth framing restrictions.
- 254 served assets matched the retained builds byte for byte across public,
  customer, and partner hosts, including the sample PDF.
- Live browser inspection confirmed pricing/sample content and layout. Sign-in
  recognized the existing session and opened its authorized workspace; fresh
  credential entry and external OAuth completion were not exercised.
- Final whitespace and working-tree checks passed before this release record.

The first live smoke run used the previous state-title wording and failed those
51 title assertions. Updating the smoke expectations to the current source title
and decoding HTML entities produced the passing run above. No deployed code was
changed to satisfy the smoke script.

No real purchase, paid analysis, or production email was used for verification.
Backend readiness is HTTP evidence; its control-plane revision was not refreshed.

## Recovery and evidence

The previous versions in the table are independent rollback targets. No database
rollback is involved. Frozen source, full path inventory, build and deployment
logs, test results, browser artifacts, smoke checks, and asset hashes are retained
at `/Users/zafaralitolibov/.venfour-releases/2026-09-27/`. The frozen source matched
every tracked file at the released source commit.
