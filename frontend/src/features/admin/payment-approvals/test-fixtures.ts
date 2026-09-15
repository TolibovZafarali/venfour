export function approvalFixture() {
  const id = "11111111-1111-4111-8111-111111111111";
  return { caseId: id, customerId: id, customerName: "Fictional Driver", customerEmail: "fixture@example.test",
    vehicle: "2024 Honda Accord EX", insurerValuation: 20000, preliminaryOutcome: "CLEAR_MARKET_VALUE_GAP",
    classification: "POTENTIAL_UNDERVALUE", evidenceStrength: "MODERATE", eligibleComparables: { current: 4, historical: 3 },
    limitations: [{ label: "Advertised prices", description: "Asking prices are not completed sales." }], reportReady: true,
    lineage: { caseId: id, ownerId: id, inputId: id, sourceRunId: id, reportId: id, assessmentId: id, inputRevision: 2,
      reportRevision: 4, assessmentVersion: "1", documentDigest: "a".repeat(64), assessmentDigest: "b".repeat(64),
      assessmentPayloadDigest: "c".repeat(64), sourceDigest: "d".repeat(64), readinessDigest: "e".repeat(64), inputDigest: "f".repeat(64) },
    status: "awaiting_approval", canApprove: true };
}
