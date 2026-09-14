"""Offline verification of the packaged paid-report release qualification."""

from collections.abc import Mapping

from venfour.report_review import ReportReviewConfiguration
from venfour.report_review_evals import ReportReviewEvalError, load_report_review_eval_attestation


def paid_release_configuration_status(environment: Mapping[str, str]) -> dict:
    """Return bounded configuration facts without calling an external provider."""
    try:
        config = ReportReviewConfiguration.from_environment(environment)
        if not config.release_gate_enabled:
            return {"configured": False, "reason": "REPORT_RELEASE_GATE_DISABLED"}
        if (not config.approval_configuration_complete
                or config.model_identifier != config.approved_model_identifier
                or not environment.get("OPENAI_API_KEY")
                or any(character.isspace() or ord(character) < 32 or ord(character) == 127
                       for character in environment.get("OPENAI_API_KEY", ""))):
            return {"configured": False, "reason": "REPORT_REVIEW_NOT_CONFIGURED"}
        attestation = load_report_review_eval_attestation(
            expected_model_identifier=config.approved_model_identifier,
            expected_prompt_version=config.approved_prompt_version,
            expected_review_schema_version=config.approved_schema_version,
            expected_eval_suite_digest=config.approved_eval_suite_digest,
        )
        if attestation is None:
            return {"configured": False, "reason": "REPORT_REVIEW_QUALIFICATION_UNAVAILABLE"}
        return {"configured": True, "qualification": attestation.to_dict()}
    except (OSError, ReportReviewEvalError, TypeError, ValueError):
        return {"configured": False, "reason": "REPORT_REVIEW_QUALIFICATION_INVALID"}
