# Fictional service-output exhibits

These exhibits accompany the [Missouri existing-service review packet](../missouri-existing-service-review-packet.md).
All inputs come from existing repository tests/templates at
`f8a3f7a3fd90da914e9d9f6692e7972d6a965e21`. They contain no live customer records.
Fictional amounts are examples, not promised results or regulatory determinations.

| Files | Origin and what was actually executed |
| --- | --- |
| [supported-review.pdf](supported-review.pdf), [JSON](supported-review.json), [text](supported-review.txt) | `tests/test_valuation_evidence_report.py::ValuationEvidenceReportTests._report` with default `MATERIAL_PRICES`; current report builder, renderer with `fictional=True`, and PDF validator |
| [no-support-review.pdf](no-support-review.pdf), [JSON](no-support-review.json), [text](no-support-review.txt) | Same fixture with existing `CONSISTENT_PRICES`; current builder, renderer and validator |
| [free-result.json](free-result.json) | `tests/test_preliminary_result.py::project` using the existing three-listing, no-offer, strong-evidence fixture. VIN identity values redacted in exported projection after calculation; this redacted copy is not a replay/contract input |
| [response-and-follow-up.json](response-and-follow-up.json) | `tests/test_insurer_response_followup.py::InsurerResponseFollowupTests._inputs`; canned analysis, actual deterministic recommendation and follow-up builder. Customer/adjuster names changed to explicit fictional labels and recipient to `adjuster@example.invalid` before draft generation |
| [initial-request-template.json](initial-request-template.json) | Exact copy of `templates/total-loss-reconsideration-email.json`, version `initial-reconsideration-v3`. Production database generator was not run; placeholders are intentional |
| [provenance.json](provenance.json) | Source revision, current template/renderer validation, page counts, PDF hashes and offline guard results |

The PDFs are actual current-renderer outputs, not screenshot mockups. Each has two
pages; all four pages were visually checked for clipping and readable labels. They
identify fictional test data on the first page and in page footers. PDF validation
status is `PASS` in both retained manifests. Text extraction is provided for convenient
review and is not a replacement for the PDF layout.

The report fixture has existing compatible frozen source inputs. It does not execute
new checkout, the report-upload readiness gate, payment, a live model review, staff
release, hosted publication, storage upload, a refund or email. The response-analysis
object is deliberately a test double; its prose is not proof of what a model would
say about this particular response. Its references and uncertainty demonstrate the
contract consumed by deterministic coaching. The customer chose to continue in the
follow-up fixture despite a `NO_CLEAR_RECOMMENDATION` result.

Generation cleared inherited environment configuration/credentials and installed
`scripts/run_offline_tests.py::OfflineNetworkGuard`. Three deliberate guard probes
were blocked before network access, and zero unexpected network attempts occurred.
Synthetic provider implementations supplied the listings. No signing/authority tools
or authority test modules were invoked.

Four focused offline checks passed with zero failures, errors, skips or unexpected
network attempts (32.361 seconds):

```sh
.venv/bin/python scripts/run_offline_tests.py \
  tests.test_valuation_evidence_report.ValuationEvidenceReportTests.test_pdf_renderer_and_pymupdf_manifest_validate_full_report \
  tests.test_valuation_evidence_report.ValuationEvidenceReportTests.test_non_supportable_and_review_required_results_are_truthful \
  tests.test_preliminary_result.PreliminaryResultTests.test_strong_and_good_existing_evidence_can_support_range_without_offer \
  tests.test_insurer_response_followup.InsurerResponseFollowupTests.test_followup_addresses_exact_response_and_preserves_initial_request
```

Documentation checks verified companion JSON parses, ten unanswered capability
worksheets, source paths/local links, preserved PDF hashes, and unchanged baseline
hashes for all 1,588 existing tracked files. `git diff --check` and whitespace checks
on every new text file passed. The only repository additions are this documentation
bundle. Registry rules/interpretations and all reviewer/publisher/writer lists remain
empty. These are local checks, not hosted operational or legal proof.
