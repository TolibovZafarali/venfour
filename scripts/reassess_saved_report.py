"""Reassess saved observations against labeled PDF facts without provider calls."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import sys
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from venfour.analysis_runs import _target_from_data
from venfour.comparable_evidence import assess_observation
from venfour.efficient_search import EfficientSearchPolicy, replay_efficient_search
from venfour.report_ingestion import validate_canonical_pdf
from venfour.report_vehicle_facts import engine_matching_facts, recover_labeled_engine_details


def reassess(artifact: dict, pdf_path: Path) -> dict:
    """Return a separate diagnostic revision; never modify the saved analysis."""
    search = artifact["result"]["marketSearch"]
    replay_efficient_search(search)
    vehicle = (artifact["request"].get("qualificationSourceReport") or {}).get("vehicle")
    if not vehicle or vehicle.get("vin") != search["input"]["subjectVin"]:
        raise ValueError("The saved report must identify the same subject as the search")
    document = validate_canonical_pdf(pdf_path)
    recovered = recover_labeled_engine_details(vehicle, document.page_texts)
    if not recovered.get("engineDetails"):
        raise ValueError("No labeled engine specifications were recovered for this vehicle")
    facts = copy.deepcopy(search["input"]["subjectFacts"])
    facts.update(engine_matching_facts(recovered))
    target = _target_from_data(search["input"]["target"])
    rows = []
    for index, observation in enumerate(search["observations"]):
        assessment = assess_observation(
            target, observation, subject_material_facts=facts,
            evidence_date=(search["input"].get("historicalRequest") or {}).get("evidenceDate"),
            max_distance_miles=EfficientSearchPolicy(**search["input"]["policy"]).boundary,
            free_estimate=search["input"].get("readinessStage") == "free_estimate",
            normalization_version=search["input"].get("normalizationVersion", "1"),
        )
        rows.append({"observationIndex": index, "stream": observation["stream"],
                     "previousReasons": observation["assessment"]["reasonCodes"],
                     "reassessedReasons": assessment["reasonCodes"],
                     "previousBaselineEligible": observation["assessment"]["baselineEligible"],
                     "baselineEligible": assessment["baselineEligible"]})
    return {"kind": "LOCAL_REPORT_REASSESSMENT", "revisionId": str(uuid4()),
            "parentRunId": artifact["runId"], "parentSearchDigest": search["digest"],
            "parentArtifactDigest": hashlib.sha256(json.dumps(artifact, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
            "documentSha256": document.sha256, "recoveredEngineDetails": recovered["engineDetails"],
            "matchingFacts": engine_matching_facts(recovered), "providerRequests": 0,
            "observations": rows, "baselineEligibleCount": sum(row["baselineEligible"] for row in rows),
            "limitation": "Local reassessment of existing observations only. This does not replace the saved result or establish a new market range."}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact", required=True, type=Path)
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.output.resolve() in {args.artifact.resolve(), args.pdf.resolve()}:
        parser.error("Output must not overwrite an input")
    data = json.loads(args.artifact.read_text())
    if isinstance(data, list):
        if len(data) != 1:
            parser.error("Select exactly one saved run")
        data = data[0]
    result = reassess(data.get("artifact", data), args.pdf)
    # Exclusive creation preserves earlier diagnostic revisions too.
    with args.output.open("x") as output:
        args.output.chmod(0o600)
        json.dump(result, output, indent=2)
        output.write("\n")
    print(json.dumps({"observations": len(result["observations"]), "baselineEligible": result["baselineEligibleCount"], "providerRequests": 0}))


if __name__ == "__main__":
    main()
