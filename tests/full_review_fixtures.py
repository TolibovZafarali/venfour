"""Source-complete synthetic strict evidence with an entirely mocked transport."""

import copy
from functools import lru_cache
import tempfile

from tests.test_efficient_analysis import run_analysis
from tests.test_efficient_search import candidate
from tests.test_full_review import snapshot
from tests.test_preliminary_qualification import qualification_inputs, renormalize_source
from tests.test_ccc_evidence import source_fixture
from venfour.full_review import full_review_readiness
from venfour.full_review_calculation import calculate_report_review
from venfour.report_ingestion import normalize_ccc_report, ReportIngestionResult


@lru_cache(maxsize=1)
def _fixture():
    with tempfile.TemporaryDirectory() as directory:
        artifact, _, transport, _ = run_analysis(
            directory, [candidate(i, price=24000+i*100) for i in range(12)], offer=20000,
        )
    source = qualification_inputs()
    raw = source["source_report"]
    raw["vehicle"].update(artifact.to_dict()["request"]["qualificationSourceReport"]["vehicle"])
    raw["report"].update(insurer="Example Insurance", lossDate="2026-08-03")
    raw["comparables"][0].update(make="Hyundai", model="Elantra")
    renormalize_source(source)
    raw = source["source_report"]
    raw["contributionRows"] = raw["evidence"]["contributionRows"]
    raw["comparables"] = [{key: row[key] for key in source_fixture()["comparables"][0]} for row in raw["comparables"]]
    normalized = normalize_ccc_report(raw)
    extraction = ReportIngestionResult(normalized, "CCC", "CCC", "CCC", "HIGH", False, (), (), "a"*64).to_dict()
    saved = {**snapshot(), "vehicle_make": "Hyundai", "vehicle_model": "Elantra", "postal_code": "63026"}
    readiness = full_review_readiness(saved, extraction)
    before = len(transport.calls)
    calculation = calculate_report_review(artifact.to_dict(), extraction, readiness,
        report_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", created_at="2026-09-14T21:00:00Z")
    assert len(transport.calls) == before
    return {"artifact": artifact.to_dict(), "input": saved, "extraction": extraction,
            "readiness": readiness, "calculation": calculation}


def strict_fixture():
    return copy.deepcopy(_fixture())
