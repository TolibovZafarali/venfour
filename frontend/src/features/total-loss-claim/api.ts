import { environment } from "@/config/env";
import type {
  TotalLossClaimAccessLink,
  TotalLossClaimCommerceProjection,
  TotalLossClaimEntitlementStatus,
  TotalLossClaimFulfillmentState,
  TotalLossClaimJourneyProjection,
  TotalLossClaimJourneyState,
  TotalLossClaimOrderStatus,
  TotalLossClaimPhase,
  TotalLossClaimPaymentStatus,
  TotalLossClaimRecoveryAccepted,
  TotalLossClaimRecoveryRequest,
  TotalLossClaimResolver,
  TotalLossClaimWorkflowProjection,
  TotalLossCaseResolution,
  TotalLossCaseResolutionInput,
  TotalLossCaseResolutionRecorded,
  TotalLossCheckoutProjection,
  TotalLossCheckoutQuote,
  TotalLossCheckoutState,
  TotalLossEducationProgressState,
  TotalLossEducationProjection,
  TotalLossEducationStep,
  TotalLossEducationStepProgress,
  TotalLossFollowUp,
  TotalLossInsurerEvidence,
  TotalLossInsurerComparable,
  TotalLossInsurerEvidenceSummary,
  TotalLossInsurerResponse,
  TotalLossInsurerResponseAnalysis,
  TotalLossInsurerResponseAnalysisEvidence,
  TotalLossInsurerResponseDocument,
  TotalLossInsurerResponseDownload,
  TotalLossInsurerResponseMediaType,
  TotalLossInsurerResponseRecorded,
  TotalLossInsurerResponseUploadPreparation,
  TotalLossResponseRecommendation,
  TotalLossResponseUsableOffer,
  TotalLossResponseDecision,
  TotalLossResponseDecisionInput,
  TotalLossResponseDecisionRecorded,
  TotalLossMarketComparable,
  TotalLossMarketEvidence,
  TotalLossMarketEvidenceDateContext,
  TotalLossMarketEvidenceSummary,
  TotalLossMessageDraft,
  TotalLossMoney,
  TotalLossPreliminaryComparison,
  TotalLossPriceSummary,
  TotalLossPreparedMessage,
  TotalLossPreparedMessageVersion,
  TotalLossPublishedReport,
  TotalLossPublishedReportConclusion,
  TotalLossReportDownload,
  TotalLossSendingDetails,
  TotalLossSentMessage,
  TotalLossSentCommunication,
  TotalLossSupersededFollowUpDraft,
  TotalLossResponseIntake,
  TotalLossNegotiationHistoryRound,
  TotalLossSupportedRange,
} from "@/features/total-loss-claim/contracts";
import {
  TOTAL_LOSS_EDUCATION_STEPS,
  TOTAL_LOSS_INSURER_RESPONSE_MEDIA_TYPES,
} from "@/features/total-loss-claim/contracts";
import { createApiClient } from "@/lib/api/client";

const apiClient = createApiClient({ baseUrl: environment.apiBaseUrl });
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const CLAIM_PHASES = new Set<TotalLossClaimPhase>([
  "initial_request",
  "negotiation",
  "resolution",
  "review",
]);
const CLAIM_ORDER_STATUSES = new Set<TotalLossClaimOrderStatus>([
  "pending",
  "paid",
  "partially_refunded",
  "refunded",
  "disputed",
  "void",
]);
const CLAIM_PAYMENT_STATUSES = new Set<TotalLossClaimPaymentStatus>([
  "pending",
  "succeeded",
  "refunded",
  "disputed",
]);
const CLAIM_ENTITLEMENT_STATUSES = new Set<TotalLossClaimEntitlementStatus>([
  "active",
  "refunded_access_retained",
  "suspended",
  "revoked",
]);
const SAFE_TASK_PATTERN = /^[a-z][a-z0-9_]{0,63}$/u;
const SAFE_FILENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_. -]{0,175}\.pdf$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;
const RESPONSE_EVIDENCE_REFERENCE_PATTERN = /^response_[a-f0-9]{64}$/u;
const CASE_EVIDENCE_REFERENCE_PATTERN = /^case_[a-f0-9]{64}$/u;
const JOURNEY_STATES = new Set<TotalLossClaimJourneyState>([
  "resolved",
  "secure_claim",
  "checkout",
  "checkout_confirmation",
  "processing",
  "guide_result",
  "guide_insurer_review",
  "guide_valuation",
  "guide_report",
  "guide_what_next",
  "prepare_request",
  "awaiting_insurer_response",
  "insurer_response_received",
  "insurer_response_reviewing",
  "insurer_response_reviewed",
  "insurer_response_review_unavailable",
  "follow_up_preparation",
  "no_dispute",
  "needs_attention",
]);
const FULFILLMENT_STATES = new Set<TotalLossClaimFulfillmentState>([
  "resolved",
  "not_started",
  "payment_pending",
  "finalizing",
  "exception_review",
  "report_ready",
  "refund_pending",
  "no_dispute",
  "needs_attention",
  "awaiting_insurer_response",
  "insurer_response_received",
  "insurer_response_reviewing",
  "insurer_response_reviewed",
  "insurer_response_review_unavailable",
  "follow_up_preparation",
]);
const INSURER_RESPONSE_PROCESSING_STATES = new Set<
  TotalLossInsurerResponse["processingState"]
>([
  "pending",
  "processing",
  "completed",
  "retryable_failed",
  "terminal_failed",
  "unsupported",
]);
const INSURER_RESPONSE_FAILURE_REASONS = new Set<
  NonNullable<TotalLossInsurerResponse["failureReason"]>
>(["generic", "unreadable_document", "unsupported_document"]);
const INSURER_RESPONSE_MEDIA_TYPES = new Set<TotalLossInsurerResponseMediaType>(
  TOTAL_LOSS_INSURER_RESPONSE_MEDIA_TYPES,
);
const CHECKOUT_STATES = new Set<TotalLossCheckoutState>([
  "already_fulfilled",
  "checkout_ready",
  "payment_pending",
  "reconciled",
]);
const CHECKOUT_STATUSES = new Set([
  "creating",
  "open",
  "complete",
  "expired",
  "failed",
]);

export class TotalLossClaimContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TotalLossClaimContractError";
  }
}

function claimPath(caseId: string) {
  return `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/claim`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  field: string,
  pattern?: RegExp,
) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    (pattern && !pattern.test(value))
  ) {
    throw new TotalLossClaimContractError(
      `The claim service returned an invalid ${field}.`,
    );
  }
  return value;
}

function safeResponseFilename(value: unknown, field: string) {
  const filename = requiredString(value, field);
  const hasControlCharacter = [...filename].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (
    [...filename].length > 255 ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename === "." ||
    filename === ".." ||
    hasControlCharacter
  ) {
    throw new TotalLossClaimContractError(
      `The claim service returned an invalid ${field}.`,
    );
  }
  return filename;
}

function insurerResponseMediaType(
  value: unknown,
  field: string,
): TotalLossInsurerResponseMediaType {
  if (
    typeof value !== "string" ||
    !INSURER_RESPONSE_MEDIA_TYPES.has(value as TotalLossInsurerResponseMediaType)
  ) {
    throw new TotalLossClaimContractError(
      `The claim service returned an invalid ${field}.`,
    );
  }
  return value as TotalLossInsurerResponseMediaType;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requiredString(value, field);
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new TotalLossClaimContractError(
      `The claim service returned an invalid ${field}.`,
    );
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TotalLossClaimContractError(
      `The claim service returned an invalid ${field}.`,
    );
  }
  return Number(value);
}

function nonnegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TotalLossClaimContractError(
      `The claim service returned an invalid ${field}.`,
    );
  }
  return Number(value);
}

function workflowRevision(value: unknown): number {
  return positiveInteger(value, "workflow revision");
}

function mapMoney(value: unknown, field: string): TotalLossMoney {
  if (!isRecord(value)) {
    throw new TotalLossClaimContractError(
      `The claim service returned invalid ${field}.`,
    );
  }
  if (
    value.amountMinorUnits !== null &&
    !Number.isSafeInteger(value.amountMinorUnits)
  ) {
    throw new TotalLossClaimContractError(
      `The claim service returned invalid ${field}.`,
    );
  }
  const currency = requiredString(
    value.currency,
    `${field} currency`,
    CURRENCY_PATTERN,
  );
  return {
    amountMinorUnits:
      value.amountMinorUnits === null ? null : Number(value.amountMinorUnits),
    currency,
    formatted: requiredString(value.formatted, `${field} display value`),
  };
}

function mapSupportedRange(value: unknown): TotalLossSupportedRange {
  if (!isRecord(value)) {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid supported range.",
    );
  }
  return {
    evidenceBasis:
      value.evidenceBasis === undefined || value.evidenceBasis === null
        ? null
        : requiredString(value.evidenceBasis, "evidence basis"),
    high: mapMoney(value.high, "supported high value"),
    low: mapMoney(value.low, "supported low value"),
    median: mapMoney(value.median, "supported median value"),
  };
}

function mapPreliminaryComparison(
  value: unknown,
): TotalLossPreliminaryComparison {
  if (!isRecord(value)) {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid preliminary comparison.",
    );
  }
  return {
    status: requiredString(value.status, "preliminary comparison status"),
    summary: requiredString(
      value.summary,
      "preliminary comparison summary",
    ),
  };
}

function mapPriceSummary(
  value: unknown,
  field: string,
): TotalLossPriceSummary | null {
  if (value === null) return null;
  if (!isRecord(value)) {
    throw new TotalLossClaimContractError(
      `The claim service returned invalid ${field}.`,
    );
  }
  const money = (key: "low" | "median" | "high") =>
    value[key] === null ? null : mapMoney(value[key], `${field} ${key}`);
  return {
    count: nonnegativeInteger(value.count, `${field} count`),
    high: money("high"),
    low: money("low"),
    median: money("median"),
  };
}

function mapInsurerEvidenceSummary(
  value: unknown,
): TotalLossInsurerEvidenceSummary {
  if (!isRecord(value)) {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid insurer evidence summary.",
    );
  }
  return {
    adjustedValueMissingCount: nonnegativeInteger(
      value.adjustedValueMissingCount,
      "adjusted-value missing count",
    ),
    adjustedValues: mapPriceSummary(
      value.adjustedValues,
      "insurer adjusted-value summary",
    ),
    advertisedPriceMissingCount: nonnegativeInteger(
      value.advertisedPriceMissingCount,
      "advertised-price missing count",
    ),
    advertisedPrices: mapPriceSummary(
      value.advertisedPrices,
      "insurer advertised-price summary",
    ),
    fullyDisclosedAdjustmentCount: nonnegativeInteger(
      value.fullyDisclosedAdjustmentCount,
      "fully disclosed adjustment count",
    ),
    partiallyDisclosedAdjustmentCount: nonnegativeInteger(
      value.partiallyDisclosedAdjustmentCount,
      "partially disclosed adjustment count",
    ),
    totalCount: nonnegativeInteger(value.totalCount, "insurer summary count"),
    unavailableAdjustmentCount: nonnegativeInteger(
      value.unavailableAdjustmentCount,
      "unavailable adjustment count",
    ),
    undisclosedAdjustmentCount: nonnegativeInteger(
      value.undisclosedAdjustmentCount,
      "undisclosed adjustment count",
    ),
  };
}

function nullableFiniteNumber(value: unknown, field: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TotalLossClaimContractError(
      `The claim service returned an invalid ${field}.`,
    );
  }
  return value;
}

function mapInsurerComparable(
  value: unknown,
  index: number,
): TotalLossInsurerComparable {
  if (!isRecord(value) || !isRecord(value.adjustments)) {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid insurer comparable.",
    );
  }
  const field = `insurer comparable ${index + 1}`;
  return {
    adjustedValue: nullableString(value.adjustedValue, `${field} adjusted value`),
    adjustmentDisclosure: nullableString(
      value.adjustmentDisclosure,
      `${field} adjustment disclosure`,
    ),
    adjustments: {
      condition: nullableString(
        value.adjustments.condition,
        `${field} condition adjustment`,
      ),
      mileage: nullableString(
        value.adjustments.mileage,
        `${field} mileage adjustment`,
      ),
      options: nullableString(
        value.adjustments.options,
        `${field} options adjustment`,
      ),
      package: nullableString(
        value.adjustments.package,
        `${field} package adjustment`,
      ),
    },
    advertisedPrice: nullableString(
      value.advertisedPrice,
      `${field} advertised price`,
    ),
    contributionPercent: nullableFiniteNumber(
      value.contributionPercent,
      `${field} contribution`,
    ),
    mileage: nullableFiniteNumber(value.mileage, `${field} mileage`),
    netAdjustment: nullableString(
      value.netAdjustment,
      `${field} net adjustment`,
    ),
    vehicle: nullableString(value.vehicle, `${field} vehicle`),
  };
}

function mapInsurerEvidence(value: unknown): TotalLossInsurerEvidence {
  if (
    !isRecord(value) ||
    !Array.isArray(value.comparables) ||
    value.comparables.length > 500
  ) {
    throw new TotalLossClaimContractError(
      "The claim service returned invalid insurer evidence.",
    );
  }
  return {
    adjustmentContext: nullableString(
      value.adjustmentContext,
      "insurer adjustment context",
    ),
    comparableCount: nonnegativeInteger(
      value.comparableCount,
      "insurer comparable count",
    ),
    comparables: value.comparables.map(mapInsurerComparable),
    insurerName: nullableString(value.insurerName, "insurer name"),
    methodologyStatement: nullableString(
      value.methodologyStatement,
      "insurer evidence methodology",
    ),
    summary: mapInsurerEvidenceSummary(value.summary),
  };
}

function nullableDate(value: unknown, field: string): string | null {
  return value === null
    ? null
    : requiredString(value, field, ISO_DATE_PATTERN);
}

function mapMarketSummary(
  value: unknown,
  field: string,
): TotalLossMarketEvidenceSummary | null {
  if (value === null) return null;
  if (!isRecord(value)) {
    throw new TotalLossClaimContractError(
      `The claim service returned invalid ${field}.`,
    );
  }
  return {
    description: nullableString(value.description, `${field} description`),
    evidenceDate: nullableDate(value.evidenceDate, `${field} evidence date`),
    label: nullableString(value.label, `${field} label`),
    prices: mapPriceSummary(value.prices, `${field} price summary`),
    selectedCount: nonnegativeInteger(
      value.selectedCount,
      `${field} selected count`,
    ),
  };
}

function nullableNonnegativeNumber(
  value: unknown,
  field: string,
): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TotalLossClaimContractError(
      `The claim service returned an invalid ${field}.`,
    );
  }
  return value;
}

function mapMarketComparable(
  value: unknown,
  index: number,
): TotalLossMarketComparable {
  if (!isRecord(value)) {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid market comparable.",
    );
  }
  const field = `market comparable ${index + 1}`;
  return {
    advertisedPrice: nullableString(
      value.advertisedPrice,
      `${field} advertised price`,
    ),
    dealer: nullableString(value.dealer, `${field} dealer`),
    distanceMiles: nullableNonnegativeNumber(
      value.distanceMiles,
      `${field} distance`,
    ),
    evidenceDate: nullableDate(value.evidenceDate, `${field} evidence date`),
    location: nullableString(value.location, `${field} location`),
    mileage: nullableNonnegativeNumber(value.mileage, `${field} mileage`),
    role: nullableString(value.role, `${field} role`),
    temporalBasis: nullableString(
      value.temporalBasis,
      `${field} temporal basis`,
    ),
    vehicle: nullableString(value.vehicle, `${field} vehicle`),
  };
}

function mapEvidenceDateContext(
  value: unknown,
): TotalLossMarketEvidenceDateContext {
  if (!isRecord(value)) {
    throw new TotalLossClaimContractError(
      "The claim service returned invalid evidence date context.",
    );
  }
  const date = (key: string, field: string) =>
    value[key] === undefined || value[key] === null
      ? null
      : requiredString(value[key], field, ISO_DATE_PATTERN);
  return {
    currentObservedDate: date(
      "currentObservedDate",
      "current evidence observation date",
    ),
    historicalEvidenceDate: date(
      "historicalEvidenceDate",
      "historical evidence date",
    ),
    lossDate: date("lossDate", "loss date"),
  };
}

function mapMarketEvidence(value: unknown): TotalLossMarketEvidence {
  if (
    !isRecord(value) ||
    !Array.isArray(value.comparables) ||
    value.comparables.length > 500
  ) {
    throw new TotalLossClaimContractError(
      "The claim service returned invalid market evidence.",
    );
  }
  return {
    comparables: value.comparables.map(mapMarketComparable),
    evidenceDateContext: mapEvidenceDateContext(value.evidenceDateContext),
    methodologyStatement: nullableString(
      value.methodologyStatement,
      "market evidence methodology",
    ),
    primary: mapMarketSummary(value.primary, "primary market evidence"),
    secondary: mapMarketSummary(value.secondary, "secondary market evidence"),
  };
}

function stringList(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new TotalLossClaimContractError(
      `The claim service returned invalid ${field}.`,
    );
  }
  return value.map((item) => requiredString(item, field));
}

function mapConclusion(value: unknown): TotalLossPublishedReportConclusion {
  if (!isRecord(value)) {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid report conclusion.",
    );
  }
  return {
    classificationLabel: requiredString(
      value.classificationLabel,
      "report classification label",
    ),
    continuingSupported: requiredBoolean(
      value.continuingSupported,
      "continuing recommendation",
    ),
    indicatedDifference:
      value.indicatedDifference === null
        ? null
        : mapMoney(value.indicatedDifference, "indicated difference"),
    insurerValuation: mapMoney(value.insurerValuation, "insurer valuation"),
    limitations: stringList(value.limitations, "report limitations"),
    preliminaryComparison: mapPreliminaryComparison(
      value.preliminaryComparison,
    ),
    summary: requiredString(value.summary, "report summary"),
    supportedRange:
      value.supportedRange === null
        ? null
        : mapSupportedRange(value.supportedRange),
  };
}

function mapSubjectVehicle(value: unknown) {
  if (!isRecord(value)) {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid subject vehicle.",
    );
  }
  return {
    description: nullableString(
      value.description,
      "subject vehicle description",
    ),
  };
}

function mapReport(value: unknown): TotalLossPublishedReport | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || value.status !== "published") {
    throw new TotalLossClaimContractError(
      "The claim service returned invalid published-report metadata.",
    );
  }
  return {
    conclusion: mapConclusion(value.conclusion),
    insurerEvidence: mapInsurerEvidence(value.insurerEvidence),
    issueDate: requiredString(value.issueDate, "report issue date", ISO_DATE_PATTERN),
    marketEvidence: mapMarketEvidence(value.marketEvidence),
    reportId: requiredString(value.reportId, "report ID", UUID_PATTERN),
    status: "published",
    subjectVehicle: mapSubjectVehicle(value.subjectVehicle),
    suggestedFilename: requiredString(
      value.suggestedFilename,
      "report filename",
      SAFE_FILENAME_PATTERN,
    ),
    versionLabel: requiredString(value.versionLabel, "report version label"),
    versionNumber: positiveInteger(value.versionNumber, "report version number"),
  };
}

function mapJourney(value: unknown): TotalLossClaimJourneyProjection | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) {
    throw new TotalLossClaimContractError(
      "The claim service returned invalid customer journey state.",
    );
  }
  const nextState = requiredString(value.nextState, "next customer state");
  const fulfillmentState = requiredString(
    value.fulfillmentState,
    "fulfillment state",
  );
  if (
    !JOURNEY_STATES.has(nextState as TotalLossClaimJourneyState) ||
    !FULFILLMENT_STATES.has(
      fulfillmentState as TotalLossClaimFulfillmentState,
    )
  ) {
    throw new TotalLossClaimContractError(
      "The claim service returned unsupported customer journey state.",
    );
  }
  return {
    fulfillmentState: fulfillmentState as TotalLossClaimFulfillmentState,
    nextState: nextState as TotalLossClaimJourneyState,
    retryable: requiredBoolean(value.retryable, "journey retry state"),
  };
}

function mapProgressStep(
  value: unknown,
  step: TotalLossEducationStep,
): TotalLossEducationStepProgress {
  if (!isRecord(value)) {
    throw new TotalLossClaimContractError(
      `The claim service returned invalid ${step} progress.`,
    );
  }
  const timestamp = (candidate: unknown, field: string) =>
    candidate === null
      ? null
      : requiredString(candidate, field, ISO_TIMESTAMP_PATTERN);
  return {
    completedAt: timestamp(value.completedAt, `${step} completion`),
    skippedAt: timestamp(value.skippedAt, `${step} skip`),
    viewedAt: timestamp(value.viewedAt, `${step} view`),
  };
}

function mapEducation(value: unknown): TotalLossEducationProjection | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || !isRecord(value.steps)) {
    throw new TotalLossClaimContractError(
      "The claim service returned invalid education progress.",
    );
  }
  const stepValues = value.steps;
  const steps = Object.fromEntries(
    TOTAL_LOSS_EDUCATION_STEPS.map((step) => [
      step,
      mapProgressStep(stepValues[step], step),
    ]),
  ) as unknown as TotalLossEducationProjection["steps"];
  return {
    reportVersionId: requiredString(
      value.reportVersionId,
      "education report version ID",
      UUID_PATTERN,
    ),
    steps,
  };
}

function mapSendingDetails(value: unknown): TotalLossSendingDetails | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) {
    throw new TotalLossClaimContractError(
      "The claim service returned invalid sending details.",
    );
  }
  return {
    adjusterEmail: nullableString(value.adjusterEmail, "adjuster email"),
    adjusterEmailConfirmed: requiredBoolean(
      value.adjusterEmailConfirmed,
      "adjuster email confirmation",
    ),
    adjusterName: nullableString(value.adjusterName, "adjuster name"),
    claimReference: nullableString(value.claimReference, "claim reference"),
    claimReferenceConfirmed: requiredBoolean(
      value.claimReferenceConfirmed,
      "claim reference confirmation",
    ),
    customerName: nullableString(value.customerName, "customer name"),
    insurerName: nullableString(value.insurerName, "insurer name"),
    revision: nonnegativeInteger(value.revision, "sending-details revision"),
    vehicleDescription: nullableString(
      value.vehicleDescription,
      "vehicle description",
    ),
  };
}

function mapMessageDraft(value: unknown, purpose: TotalLossMessageDraft["purpose"] = "initial_reconsideration"): TotalLossMessageDraft | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || value.purpose !== purpose) {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid message draft.",
    );
  }
  return {
    body: typeof value.body === "string" ? value.body : requiredString(value.body, "draft body"),
    draftId: requiredString(value.draftId, "draft ID", UUID_PATTERN),
    purpose,
    recipient: nullableString(value.recipient, "draft recipient"),
    reportVersionId: requiredString(
      value.reportVersionId,
      "draft report version ID",
      UUID_PATTERN,
    ),
    revision: positiveInteger(value.revision, "draft revision"),
    subject:
      typeof value.subject === "string"
        ? value.subject
        : requiredString(value.subject, "draft subject"),
    updatedAt: requiredString(value.updatedAt, "draft update time", ISO_TIMESTAMP_PATTERN),
  };
}

function mapWorkflow(value: unknown): TotalLossClaimWorkflowProjection | null {
  if (value === null) return null;
  if (!isRecord(value)) {
    throw new TotalLossClaimContractError(
      "The claim service returned invalid workflow state.",
    );
  }
  const phase = requiredString(value.phase, "workflow phase");
  const currentTask = requiredString(value.currentTask, "workflow task");
  if (
    !CLAIM_PHASES.has(phase as TotalLossClaimPhase) ||
    !SAFE_TASK_PATTERN.test(currentTask) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 1
  ) {
    throw new TotalLossClaimContractError(
      "The claim service returned invalid workflow state.",
    );
  }
  return {
    currentTask,
    phase: phase as TotalLossClaimPhase,
    revision: Number(value.revision),
  };
}

function nullableStatus<T extends string>(
  value: unknown,
  field: string,
  allowed: ReadonlySet<T>,
): T | null {
  if (value === null) return null;
  if (typeof value === "string" && allowed.has(value as T)) {
    return value as T;
  }
  throw new TotalLossClaimContractError(
    `The claim service returned an invalid ${field}.`,
  );
}

function mapCommerce(
  value: unknown,
  accessState: unknown,
): TotalLossClaimCommerceProjection | null {
  // Keep the dormant Milestone 2 route safe during a future rolling source
  // deployment. An older resolver simply projects commerce as unavailable.
  if (value === undefined || value === null) return null;
  if (accessState !== "secured" || !isRecord(value)) {
    throw new TotalLossClaimContractError(
      "The claim service returned invalid commerce state.",
    );
  }
  if (typeof value.checkoutAvailable !== "boolean") {
    throw new TotalLossClaimContractError(
      "The claim service returned invalid checkout availability.",
    );
  }
  const nextTask =
    value.nextTask === null
      ? null
      : requiredString(value.nextTask, "next task");
  if (nextTask !== null && !SAFE_TASK_PATTERN.test(nextTask)) {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid next task.",
    );
  }
  const includesPrice =
    value.amountMinorUnits !== undefined ||
    value.currency !== undefined;
  let amountMinorUnits: number | null = null;
  let currency: string | null = null;
  let formatted: string | null = null;
  const emptyPrice = value.amountMinorUnits === null && value.currency === null &&
    (value.formatted === null || value.formatted === undefined);
  if (includesPrice && !emptyPrice) {
    if (
      value.amountMinorUnits !== null &&
      (!Number.isSafeInteger(value.amountMinorUnits) ||
        Number(value.amountMinorUnits) < 0)
    ) {
      throw new TotalLossClaimContractError(
        "The claim service returned an invalid checkout price.",
      );
    }
    currency = requiredString(
      value.currency,
      "checkout currency",
      CURRENCY_PATTERN,
    );
    amountMinorUnits =
      value.amountMinorUnits === null ? null : Number(value.amountMinorUnits);
    formatted =
      value.formatted === undefined
        ? null
        : requiredString(value.formatted, "checkout price display value");
  }
  return {
    ...(includesPrice ? { amountMinorUnits, currency, formatted } : {}),
    checkoutAvailable: value.checkoutAvailable,
    entitlementStatus: nullableStatus(
      value.entitlementStatus,
      "entitlement status",
      CLAIM_ENTITLEMENT_STATUSES,
    ),
    nextTask,
    orderStatus: nullableStatus(
      value.orderStatus,
      "order status",
      CLAIM_ORDER_STATUSES,
    ),
    paymentStatus: nullableStatus(
      value.paymentStatus,
      "payment status",
      CLAIM_PAYMENT_STATUSES,
    ),
  };
}

function mapInsurerResponseDocument(
  value: unknown,
): TotalLossInsurerResponseDocument | null {
  if (value === null) return null;
  if (!isRecord(value)) {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid insurer-response document.",
    );
  }
  return {
    byteSize: positiveInteger(value.byteSize, "insurer-response document size"),
    documentId: requiredString(
      value.documentId,
      "insurer-response document ID",
      UUID_PATTERN,
    ),
    mediaType: insurerResponseMediaType(
      value.mediaType,
      "insurer-response document media type",
    ),
    originalFilename: safeResponseFilename(
      value.originalFilename,
      "insurer-response document filename",
    ),
  };
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  field: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TotalLossClaimContractError(
      `The claim service returned invalid ${field}.`,
    );
  }
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = [...keys].sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new TotalLossClaimContractError(
      `The claim service returned invalid ${field}.`,
    );
  }
  return value;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  field: string,
): T {
  if (typeof value !== "string" || !allowed.has(value as T)) {
    throw new TotalLossClaimContractError(
      `The claim service returned invalid ${field}.`,
    );
  }
  return value as T;
}

function mappedList<T>(
  value: unknown,
  field: string,
  map: (item: unknown, index: number) => T,
  maximumItems = 100,
): readonly T[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new TotalLossClaimContractError(
      `The claim service returned invalid ${field}.`,
    );
  }
  return value.map(map);
}

function insurerResponseAnalysisAmount(value: unknown) {
  const amount = nonnegativeInteger(
    value,
    "insurer-response revised-offer amount",
  );
  if (amount > 1_000_000_000_000) {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid insurer-response revised-offer amount.",
    );
  }
  return amount;
}

function evidenceReferenceList(
  value: unknown,
  field: string,
  pattern: RegExp,
  maximumItems = 100,
) {
  return mappedList(value, field, (item) => requiredString(item, field, pattern), maximumItems);
}

function mapResponseAnalysisReferenceSet(
  value: Record<string, unknown>,
  field: string,
) {
  return {
    caseEvidenceRefs: evidenceReferenceList(
      value.caseEvidenceRefs,
      `${field} case evidence references`,
      CASE_EVIDENCE_REFERENCE_PATTERN,
    ),
    responseEvidenceRefs: evidenceReferenceList(
      value.responseEvidenceRefs,
      `${field} response evidence references`,
      RESPONSE_EVIDENCE_REFERENCE_PATTERN,
    ),
  };
}

function mapResponseAnalysisIssue(value: unknown, index: number) {
  const field = `response-analysis item ${index + 1}`;
  const item = exactRecord(
    value,
    ["description", "responseEvidenceRefs", "caseEvidenceRefs"],
    field,
  );
  return {
    description: requiredString(item.description, `${field} description`),
    ...mapResponseAnalysisReferenceSet(item, field),
  };
}

const INSURER_POSITION_CATEGORIES = new Set<
  TotalLossInsurerResponseAnalysis["insurerPosition"]["category"]
>([
  "REVISED_OFFER",
  "MAINTAINS_PRIOR_POSITION",
  "REQUESTS_MORE_INFORMATION",
  "ACCEPTS_REQUEST",
  "MIXED",
  "UNCLEAR",
]);
const REQUEST_DISPOSITION_CATEGORIES = new Set<
  TotalLossInsurerResponseAnalysis["requestDisposition"]["category"]
>([
  "ACCEPTED",
  "PARTIALLY_ACCEPTED",
  "REJECTED",
  "MORE_INFORMATION_REQUESTED",
  "UNCLEAR",
]);
const RESPONSE_POINT_DISPOSITIONS = new Set<
  TotalLossInsurerResponseAnalysis["responsePoints"][number]["disposition"]
>([
  "ACCEPTED",
  "REJECTED",
  "QUESTIONED",
  "IGNORED",
  "UNRESOLVED",
  "UNCLEAR",
]);
const RESPONSE_ANALYSIS_CONFIDENCE = new Set<
  TotalLossInsurerResponseAnalysis["confidence"]
>(["HIGH", "MEDIUM", "LOW"]);
const RESPONSE_RECOMMENDATION_CATEGORIES = new Set<
  TotalLossInsurerResponseAnalysis["recommendedNextStep"]["category"]
>([
  "REVIEW_REVISED_OFFER",
  "MORE_INFORMATION_MAY_BE_NEEDED",
  "FOLLOW_UP_APPEARS_WARRANTED",
  "VALUATION_ISSUE_APPEARS_RESOLVED",
  "REVIEW_RESPONSE",
]);

function mapInsurerResponseAnalysis(
  value: unknown,
): TotalLossInsurerResponseAnalysis | null {
  if (value === null || value === undefined) return null;
  const analysis = exactRecord(
    value,
    [
      "schemaVersion",
      "analysisSummary",
      "insurerPosition",
      "revisedOffer",
      "requestDisposition",
      "responsePoints",
      "insurerArguments",
      "importantChanges",
      "unresolvedIssues",
      "recommendedNextStep",
      "confidence",
      "uncertainties",
      "inputCoverage",
      "untrustedInstructionDetected",
      "untrustedInstructionFollowed",
    ],
    "insurer-response analysis",
  );
  if (analysis.schemaVersion !== "1") {
    throw new TotalLossClaimContractError(
      "The claim service returned an unsupported insurer-response analysis version.",
    );
  }

  const summary = exactRecord(
    analysis.analysisSummary,
    [
      "whatInsurerSaid",
      "whatThisMeans",
      "responseEvidenceRefs",
      "caseEvidenceRefs",
    ],
    "insurer-response analysis summary",
  );
  const position = exactRecord(
    analysis.insurerPosition,
    ["category", "summary", "responseEvidenceRefs"],
    "insurer-response position",
  );
  const offer = exactRecord(
    analysis.revisedOffer,
    [
      "status",
      "amountMinorUnits",
      "currency",
      "source",
      "responseEvidenceRefs",
      "visualSourceInterpretation",
    ],
    "insurer-response revised offer",
  );
  const offerStatus = enumValue(
    offer.status,
    new Set(["PRESENT", "ABSENT", "UNCLEAR"] as const),
    "insurer-response revised-offer status",
  );
  const offerSource =
    offer.source === null
      ? null
      : enumValue(
          offer.source,
          new Set(["CUSTOMER_SUPPLIED", "INSURER_RESPONSE", "BOTH"] as const),
          "insurer-response revised-offer source",
        );
  const offerAmount =
    offer.amountMinorUnits === null
      ? null
      : insurerResponseAnalysisAmount(offer.amountMinorUnits);
  const offerCurrency =
    offer.currency === null
      ? null
      : requiredString(
          offer.currency,
          "insurer-response revised-offer currency",
          CURRENCY_PATTERN,
        );
  const offerResponseEvidenceRefs = evidenceReferenceList(
    offer.responseEvidenceRefs,
    "revised-offer response evidence references",
    RESPONSE_EVIDENCE_REFERENCE_PATTERN,
  );
  let visualSourceInterpretation: TotalLossInsurerResponseAnalysis[
    "revisedOffer"
  ]["visualSourceInterpretation"] = null;
  if (offer.visualSourceInterpretation !== null) {
    const visual = exactRecord(
      offer.visualSourceInterpretation,
      [
        "derivation",
        "derivedText",
        "responseEvidenceRef",
        "confidence",
        "originalSourceAuthoritative",
        "verificationRequired",
      ],
      "insurer-response visual offer interpretation",
    );
    const responseEvidenceRef = requiredString(
      visual.responseEvidenceRef,
      "insurer-response visual offer reference",
      RESPONSE_EVIDENCE_REFERENCE_PATTERN,
    );
    if (
      visual.derivation !== "MODEL_VISUAL_TRANSCRIPTION" ||
      visual.confidence !== "HIGH" ||
      visual.originalSourceAuthoritative !== true ||
      visual.verificationRequired !== true ||
      !offerResponseEvidenceRefs.includes(responseEvidenceRef)
    ) {
      throw new TotalLossClaimContractError(
        "The claim service returned an invalid visual revised-offer interpretation.",
      );
    }
    visualSourceInterpretation = {
      confidence: "HIGH",
      derivation: "MODEL_VISUAL_TRANSCRIPTION",
      derivedText: requiredString(
        visual.derivedText,
        "insurer-response visual offer transcription",
      ),
      originalSourceAuthoritative: true,
      responseEvidenceRef,
      verificationRequired: true,
    };
  }
  if (
    (offerStatus === "PRESENT" &&
      (offerAmount === null || offerCurrency === null || offerSource === null)) ||
    (offerStatus !== "PRESENT" &&
      (offerAmount !== null ||
        offerCurrency !== null ||
        offerSource !== null ||
        visualSourceInterpretation !== null)) ||
    (visualSourceInterpretation !== null &&
      offerSource !== "INSURER_RESPONSE" &&
      offerSource !== "BOTH")
  ) {
    throw new TotalLossClaimContractError(
      "The claim service returned inconsistent insurer-response revised-offer details.",
    );
  }

  const disposition = exactRecord(
    analysis.requestDisposition,
    ["category", "summary", "responseEvidenceRefs", "caseEvidenceRefs"],
    "insurer-response request disposition",
  );
  const recommendation = exactRecord(
    analysis.recommendedNextStep,
    ["category", "explanation", "responseEvidenceRefs", "caseEvidenceRefs"],
    "insurer-response recommendation",
  );
  const coverage = exactRecord(
    analysis.inputCoverage,
    ["pastedText", "document", "limitations"],
    "insurer-response input coverage",
  );

  return {
    analysisSummary: {
      whatInsurerSaid: requiredString(
        summary.whatInsurerSaid,
        "insurer-response summary",
      ),
      whatThisMeans: requiredString(
        summary.whatThisMeans,
        "insurer-response meaning",
      ),
      ...mapResponseAnalysisReferenceSet(
        summary,
        "insurer-response analysis summary",
      ),
    },
    confidence: enumValue(
      analysis.confidence,
      RESPONSE_ANALYSIS_CONFIDENCE,
      "insurer-response analysis confidence",
    ),
    importantChanges: mappedList(
      analysis.importantChanges,
      "insurer-response important changes",
      mapResponseAnalysisIssue,
    ),
    inputCoverage: {
      document: enumValue(
        coverage.document,
        new Set(
          ["AVAILABLE", "NOT_PROVIDED", "UNREADABLE", "UNSUPPORTED"] as const,
        ),
        "insurer-response document coverage",
      ),
      limitations: stringList(
        coverage.limitations,
        "insurer-response coverage limitations",
      ),
      pastedText: enumValue(
        coverage.pastedText,
        new Set(["AVAILABLE", "NOT_PROVIDED"] as const),
        "insurer-response text coverage",
      ),
    },
    insurerArguments: mappedList(
      analysis.insurerArguments,
      "insurer-response arguments",
      (value, index) => {
        const field = `insurer argument ${index + 1}`;
        const argument = exactRecord(
          value,
          [
            "argument",
            "whatItReliesOn",
            "responseEvidenceRefs",
            "caseEvidenceRefs",
          ],
          field,
        );
        return {
          argument: requiredString(argument.argument, `${field} text`),
          whatItReliesOn: requiredString(
            argument.whatItReliesOn,
            `${field} basis`,
          ),
          ...mapResponseAnalysisReferenceSet(argument, field),
        };
      },
    ),
    insurerPosition: {
      category: enumValue(
        position.category,
        INSURER_POSITION_CATEGORIES,
        "insurer-response position category",
      ),
      responseEvidenceRefs: evidenceReferenceList(
        position.responseEvidenceRefs,
        "insurer-position response evidence references",
        RESPONSE_EVIDENCE_REFERENCE_PATTERN,
      ),
      summary: requiredString(position.summary, "insurer-position summary"),
    },
    recommendedNextStep: {
      category: enumValue(
        recommendation.category,
        RESPONSE_RECOMMENDATION_CATEGORIES,
        "insurer-response recommendation category",
      ),
      explanation: requiredString(
        recommendation.explanation,
        "insurer-response recommendation",
      ),
      ...mapResponseAnalysisReferenceSet(
        recommendation,
        "insurer-response recommendation",
      ),
    },
    requestDisposition: {
      category: enumValue(
        disposition.category,
        REQUEST_DISPOSITION_CATEGORIES,
        "insurer-response request disposition category",
      ),
      summary: requiredString(
        disposition.summary,
        "insurer-response request disposition summary",
      ),
      ...mapResponseAnalysisReferenceSet(
        disposition,
        "insurer-response request disposition",
      ),
    },
    responsePoints: mappedList(
      analysis.responsePoints,
      "insurer-response points",
      (value, index) => {
        const field = `insurer-response point ${index + 1}`;
        const point = exactRecord(
          value,
          [
            "topic",
            "disposition",
            "whatInsurerSaid",
            "whatThisMeans",
            "responseEvidenceRefs",
            "caseEvidenceRefs",
            "confidence",
          ],
          field,
        );
        return {
          confidence: enumValue(
            point.confidence,
            RESPONSE_ANALYSIS_CONFIDENCE,
            `${field} confidence`,
          ),
          disposition: enumValue(
            point.disposition,
            RESPONSE_POINT_DISPOSITIONS,
            `${field} disposition`,
          ),
          topic: requiredString(point.topic, `${field} topic`),
          whatInsurerSaid: requiredString(
            point.whatInsurerSaid,
            `${field} insurer statement`,
          ),
          whatThisMeans: requiredString(
            point.whatThisMeans,
            `${field} meaning`,
          ),
          ...mapResponseAnalysisReferenceSet(point, field),
        };
      },
    ),
    revisedOffer: {
      amountMinorUnits: offerAmount,
      currency: offerCurrency,
      responseEvidenceRefs: offerResponseEvidenceRefs,
      source: offerSource,
      status: offerStatus,
      visualSourceInterpretation,
    },
    schemaVersion: "1",
    uncertainties: mappedList(
      analysis.uncertainties,
      "insurer-response uncertainties",
      mapResponseAnalysisIssue,
    ),
    unresolvedIssues: mappedList(
      analysis.unresolvedIssues,
      "insurer-response unresolved issues",
      mapResponseAnalysisIssue,
    ),
    untrustedInstructionDetected: requiredBoolean(
      analysis.untrustedInstructionDetected,
      "insurer-response untrusted-instruction detection",
    ),
    untrustedInstructionFollowed: requiredBoolean(
      analysis.untrustedInstructionFollowed,
      "insurer-response untrusted-instruction handling",
    ),
  };
}

function mapInsurerResponseAnalysisEvidence(
  value: unknown,
  analysis: TotalLossInsurerResponseAnalysis | null,
): TotalLossInsurerResponseAnalysisEvidence | null {
  if (value === null || value === undefined) return null;
  if (!analysis) {
    throw new TotalLossClaimContractError(
      "The claim service returned response evidence without an analysis.",
    );
  }
  const index = exactRecord(
    value,
    ["responseEvidence", "caseEvidence"],
    "insurer-response analysis evidence",
  );
  if (
    !Array.isArray(index.responseEvidence) ||
    index.responseEvidence.length > 250 ||
    !Array.isArray(index.caseEvidence) ||
    index.caseEvidence.length > 250
  ) {
    throw new TotalLossClaimContractError(
      "The claim service returned invalid insurer-response analysis evidence.",
    );
  }
  const responseRefs = new Set<string>();
  const responseEvidence = index.responseEvidence.map((value, position) => {
    const field = `insurer-response evidence item ${position + 1}`;
    const item = exactRecord(
      value,
      ["evidenceRef", "sourceType", "content", "pageNumber"],
      field,
    );
    const evidenceRef = requiredString(
      item.evidenceRef,
      `${field} reference`,
      RESPONSE_EVIDENCE_REFERENCE_PATTERN,
    );
    if (responseRefs.has(evidenceRef)) {
      throw new TotalLossClaimContractError(
        "The claim service returned duplicate insurer-response evidence.",
      );
    }
    responseRefs.add(evidenceRef);
    const sourceType = enumValue(
      item.sourceType,
      new Set(
        [
          "PASTED_TEXT",
          "DOCUMENT",
          "DOCUMENT_TEXT",
          "DOCUMENT_IMAGE",
          "CUSTOMER_SUPPLIED_OFFER",
        ] as const,
      ),
      `${field} source type`,
    );
    const pageNumber =
      item.pageNumber === null
        ? null
        : positiveInteger(item.pageNumber, `${field} page number`);
    return {
      content: nullableString(item.content, `${field} content`),
      evidenceRef,
      pageNumber,
      sourceType,
    };
  });

  const caseRefs = new Set<string>();
  const caseEvidence = index.caseEvidence.map((value, position) => {
    const field = `case evidence item ${position + 1}`;
    const item = exactRecord(
      value,
      [
        "evidenceRef",
        "evidenceType",
        "summary",
        "amountMinorUnits",
        "currency",
      ],
      field,
    );
    const evidenceRef = requiredString(
      item.evidenceRef,
      `${field} reference`,
      CASE_EVIDENCE_REFERENCE_PATTERN,
    );
    if (caseRefs.has(evidenceRef)) {
      throw new TotalLossClaimContractError(
        "The claim service returned duplicate case evidence.",
      );
    }
    caseRefs.add(evidenceRef);
    const amountMinorUnits =
      item.amountMinorUnits === null
        ? null
        : nonnegativeInteger(item.amountMinorUnits, `${field} amount`);
    const currency =
      item.currency === null
        ? null
        : requiredString(item.currency, `${field} currency`, CURRENCY_PATTERN);
    if ((amountMinorUnits === null) !== (currency === null)) {
      throw new TotalLossClaimContractError(
        "The claim service returned inconsistent case-evidence money.",
      );
    }
    return {
      amountMinorUnits,
      currency,
      evidenceRef,
      evidenceType: enumValue(
        item.evidenceType,
        new Set(
          [
            "INSURER_VALUATION",
            "VENFOUR_FINDING",
            "VENFOUR_COMPARABLE",
            "CUSTOMER_REQUEST",
            "OTHER",
          ] as const,
        ),
        `${field} type`,
      ),
      summary: requiredString(item.summary, `${field} summary`),
    };
  });

  const citedResponseRefs = new Set<string>();
  const citedCaseRefs = new Set<string>();
  const collectReferences = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(collectReferences);
      return;
    }
    if (!isRecord(node)) return;
    Object.entries(node).forEach(([key, child]) => {
      if (key === "responseEvidenceRefs" && Array.isArray(child)) {
        child.forEach((reference) => {
          if (typeof reference === "string") citedResponseRefs.add(reference);
        });
      } else if (key === "caseEvidenceRefs" && Array.isArray(child)) {
        child.forEach((reference) => {
          if (typeof reference === "string") citedCaseRefs.add(reference);
        });
      } else {
        collectReferences(child);
      }
    });
  };
  collectReferences(analysis);
  if (
    [...citedResponseRefs].some((reference) => !responseRefs.has(reference)) ||
    [...citedCaseRefs].some((reference) => !caseRefs.has(reference))
  ) {
    throw new TotalLossClaimContractError(
      "The claim service returned incomplete insurer-response evidence.",
    );
  }
  return { caseEvidence, responseEvidence };
}

function mapResponseRecommendation(value: unknown): TotalLossResponseRecommendation | null {
  if (value === null) return null;
  const item = exactRecord(value, [
    "recommendationId", "versionNumber", "analysisResultId", "schemaVersion", "policyVersion",
    "state", "summary", "reasons", "reasonCodes", "limitations", "responseEvidenceRefs", "caseEvidenceRefs",
  ], "insurer-response recommendation");
  if (item.schemaVersion !== "1" || (item.policyVersion !== "1" && item.policyVersion !== "2")) {
    throw new TotalLossClaimContractError("The claim service returned an unsupported recommendation version.");
  }
  if ((item.policyVersion === "1" && item.state !== "NO_CLEAR_RECOMMENDATION") ||
    (item.policyVersion === "2" && item.state === "ACCEPT_OFFER")) {
    throw new TotalLossClaimContractError("The claim service returned unsupported recommendation advice.");
  }
  const text = (value: unknown, field: string) => {
    const result = requiredString(value, field);
    if ([...result].length > 2_000) throw new TotalLossClaimContractError(`The claim service returned invalid ${field}.`);
    return result;
  };
  const responseEvidenceRefs = evidenceReferenceList(item.responseEvidenceRefs, "recommendation response references", RESPONSE_EVIDENCE_REFERENCE_PATTERN, 250);
  const caseEvidenceRefs = evidenceReferenceList(item.caseEvidenceRefs, "recommendation case references", CASE_EVIDENCE_REFERENCE_PATTERN, 250);
  if (new Set(responseEvidenceRefs).size !== responseEvidenceRefs.length || new Set(caseEvidenceRefs).size !== caseEvidenceRefs.length) {
    throw new TotalLossClaimContractError("The claim service returned duplicate recommendation evidence references.");
  }
  return {
    recommendationId: requiredString(item.recommendationId, "recommendation ID", UUID_PATTERN),
    versionNumber: positiveInteger(item.versionNumber, "recommendation version"),
    analysisResultId: requiredString(item.analysisResultId, "analysis result ID", UUID_PATTERN),
    schemaVersion: "1",
    policyVersion: item.policyVersion,
    state: enumValue(item.state, new Set<TotalLossResponseRecommendation["state"]>(["ACCEPT_OFFER", "CONTINUE_CHALLENGING", "NO_CLEAR_RECOMMENDATION"]), "recommendation state"),
    summary: text(item.summary, "recommendation summary"),
    reasons: mappedList(item.reasons, "recommendation reasons", (reason) => text(reason, "recommendation reason"), 10),
    reasonCodes: mappedList(item.reasonCodes, "recommendation reason codes", (reason) => requiredString(reason, "recommendation reason code", /^[A-Z][A-Z0-9_]{0,95}$/u), 10),
    limitations: mappedList(item.limitations, "recommendation limitations", (reason) => text(reason, "recommendation limitation"), 10),
    responseEvidenceRefs,
    caseEvidenceRefs,
  };
}

function mapResponseUsableOffer(value: unknown): TotalLossResponseUsableOffer | null {
  if (value === null) return null;
  const item = exactRecord(value, ["offerId", "amountMinorUnits", "currency", "source"], "usable insurer offer");
  return {
    offerId: requiredString(item.offerId, "insurer offer ID", UUID_PATTERN),
    amountMinorUnits: positiveInteger(item.amountMinorUnits, "insurer offer amount"),
    currency: requiredString(item.currency, "insurer offer currency", CURRENCY_PATTERN),
    source: enumValue(item.source, new Set<TotalLossResponseUsableOffer["source"]>(["CUSTOMER_RECORDED", "RESPONSE_TEXT"]), "insurer offer source"),
  };
}

function mapResponseDecision(value: unknown): TotalLossResponseDecision | null {
  if (value === null) return null;
  const item = exactRecord(value, ["decisionId", "clientRequestId", "recommendationId", "analysisResultId", "choice", "offerId", "amountMinorUnits", "currency", "recordedAt"], "insurer-response decision");
  return {
    decisionId: requiredString(item.decisionId, "response decision ID", UUID_PATTERN),
    clientRequestId: requiredString(item.clientRequestId, "response decision request ID", UUID_PATTERN),
    recommendationId: requiredString(item.recommendationId, "response decision recommendation ID", UUID_PATTERN),
    analysisResultId: requiredString(item.analysisResultId, "response decision analysis result ID", UUID_PATTERN),
    choice: enumValue(item.choice, new Set<TotalLossResponseDecision["choice"]>(["ACCEPT_OFFER", "CONTINUE_CHALLENGING"]), "response decision choice"),
    offerId: item.offerId === null ? null : requiredString(item.offerId, "accepted offer ID", UUID_PATTERN),
    amountMinorUnits: item.amountMinorUnits === null ? null : positiveInteger(item.amountMinorUnits, "accepted offer amount"),
    currency: item.currency === null ? null : requiredString(item.currency, "accepted offer currency", CURRENCY_PATTERN),
    recordedAt: requiredString(item.recordedAt, "response decision recorded time", ISO_TIMESTAMP_PATTERN),
  };
}

function mapInsurerResponse(value: unknown): TotalLossInsurerResponse | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid insurer response.",
    );
  }
  const sourceType = value.sourceType;
  if (sourceType !== "pasted_message" && sourceType !== "uploaded_document") {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid insurer-response source type.",
    );
  }
  if (
    typeof value.processingState !== "string" ||
    !INSURER_RESPONSE_PROCESSING_STATES.has(
      value.processingState as TotalLossInsurerResponse["processingState"],
    )
  ) {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid insurer-response processing state.",
    );
  }
  exactRecord(
    value,
    [
      "responseId",
      "clientRequestId",
      "receivedAt",
      "sourceType",
      "text",
      "document",
      "revisedOffer",
      "processingState",
      "failureReason",
      "supersedesResponseId",
      "recommendation", "usableOffer", "decision",
      ...(value.negotiationRoundId !== undefined ? ["negotiationRoundId"] : []),
      ...(value.outboundCommunicationId !== undefined ? ["outboundCommunicationId"] : []),
      ...(value.canCorrect !== undefined ? ["canCorrect"] : []),
      ...(value.processingState === "completed"
        ? ["analysis", "analysisEvidence"]
        : []),
    ],
    "insurer response",
  );
  const document = mapInsurerResponseDocument(value.document);
  if ((sourceType === "uploaded_document") !== Boolean(document)) {
    throw new TotalLossClaimContractError(
      "The claim service returned an insurer response without its document.",
    );
  }
  const analysis = mapInsurerResponseAnalysis(value.analysis);
  const analysisEvidence = mapInsurerResponseAnalysisEvidence(
    value.analysisEvidence,
    analysis,
  );
  const failureReason = value.failureReason;
  const recommendation = mapResponseRecommendation(value.recommendation);
  const usableOffer = mapResponseUsableOffer(value.usableOffer);
  const decision = mapResponseDecision(value.decision);
  if (
    (value.processingState !== "completed" && (recommendation || usableOffer || decision)) ||
    (!recommendation && (usableOffer || decision)) ||
    (recommendation?.state === "ACCEPT_OFFER" && !usableOffer) ||
    (recommendation && (
      recommendation.responseEvidenceRefs.some((reference) => !analysisEvidence?.responseEvidence.some((item) => item.evidenceRef === reference)) ||
      recommendation.caseEvidenceRefs.some((reference) => !analysisEvidence?.caseEvidence.some((item) => item.evidenceRef === reference))
    )) ||
    (decision && (
      decision.recommendationId !== recommendation?.recommendationId ||
      decision.analysisResultId !== recommendation?.analysisResultId ||
      (decision.choice === "ACCEPT_OFFER"
        ? !usableOffer || decision.offerId !== usableOffer.offerId || decision.amountMinorUnits !== usableOffer.amountMinorUnits || decision.currency !== usableOffer.currency
        : decision.offerId !== null || decision.amountMinorUnits !== null || decision.currency !== null)
    ))
  ) {
    throw new TotalLossClaimContractError("The claim service returned inconsistent response recommendation or decision lineage.");
  }
  if (
    failureReason !== null &&
    (typeof failureReason !== "string" ||
      !INSURER_RESPONSE_FAILURE_REASONS.has(
        failureReason as NonNullable<
          TotalLossInsurerResponse["failureReason"]
        >,
      ))
  ) {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid insurer-response failure reason.",
    );
  }
  const failureReasonMatchesState =
    value.processingState === "retryable_failed"
      ? failureReason === "generic"
      : value.processingState === "terminal_failed"
        ? failureReason === "generic" ||
          failureReason === "unreadable_document"
        : value.processingState === "unsupported"
          ? failureReason === "unsupported_document"
          : failureReason === null;
  if (
    (value.processingState === "completed") !== Boolean(analysis) ||
    (value.processingState === "completed") !== Boolean(analysisEvidence) ||
    analysis?.untrustedInstructionFollowed ||
    !failureReasonMatchesState
  ) {
    throw new TotalLossClaimContractError(
      "The claim service returned inconsistent insurer-response analysis state.",
    );
  }
  let revisedOffer: TotalLossInsurerResponse["revisedOffer"] = null;
  if (value.revisedOffer !== null) {
    if (!isRecord(value.revisedOffer)) {
      throw new TotalLossClaimContractError(
        "The claim service returned an invalid revised offer.",
      );
    }
    revisedOffer = {
      amountMinorUnits: positiveInteger(
        value.revisedOffer.amountMinorUnits,
        "revised-offer amount",
      ),
      currency: requiredString(
        value.revisedOffer.currency,
        "revised-offer currency",
        CURRENCY_PATTERN,
      ),
    };
  }
  if (usableOffer && (
    analysis?.revisedOffer.status !== "PRESENT" ||
    analysis.revisedOffer.amountMinorUnits !== usableOffer.amountMinorUnits ||
    analysis.revisedOffer.currency !== usableOffer.currency ||
    (usableOffer.source === "CUSTOMER_RECORDED"
      ? revisedOffer?.amountMinorUnits !== usableOffer.amountMinorUnits || revisedOffer.currency !== usableOffer.currency
      : analysis.revisedOffer.visualSourceInterpretation !== null || analysis.revisedOffer.source !== "INSURER_RESPONSE")
  )) {
    throw new TotalLossClaimContractError("The claim service returned an inconsistent usable insurer offer.");
  }
  return {
    ...(value.negotiationRoundId !== undefined ? { negotiationRoundId: requiredString(value.negotiationRoundId, "response round ID", UUID_PATTERN) } : {}),
    ...(value.outboundCommunicationId !== undefined ? { outboundCommunicationId: requiredString(value.outboundCommunicationId, "response outbound ID", UUID_PATTERN) } : {}),
    ...(value.canCorrect !== undefined ? { canCorrect: requiredBoolean(value.canCorrect, "response correction availability") } : {}),
    analysis,
    analysisEvidence,
    recommendation,
    usableOffer,
    decision,
    clientRequestId: requiredString(
      value.clientRequestId,
      "insurer-response request ID",
      UUID_PATTERN,
    ),
    document,
    failureReason:
      failureReason as TotalLossInsurerResponse["failureReason"],
    processingState:
      value.processingState as TotalLossInsurerResponse["processingState"],
    receivedAt: requiredString(
      value.receivedAt,
      "insurer-response received time",
      ISO_TIMESTAMP_PATTERN,
    ),
    responseId: requiredString(
      value.responseId,
      "insurer-response ID",
      UUID_PATTERN,
    ),
    revisedOffer,
    sourceType,
    supersedesResponseId:
      value.supersedesResponseId === null
        ? null
        : requiredString(
            value.supersedesResponseId,
            "superseded insurer-response ID",
            UUID_PATTERN,
          ),
    text: nullableString(value.text, "insurer-response text"),
  };
}

function mapInsurerResponseUploadPreparation(
  value: unknown,
): TotalLossInsurerResponseUploadPreparation {
  if (!isRecord(value)) {
    throw new TotalLossClaimContractError(
      "The claim service returned invalid insurer-response upload details.",
    );
  }
  const uploadPath = requiredString(
    value.uploadPath,
    "insurer-response upload path",
  );
  if (
    uploadPath.startsWith("/") ||
    uploadPath.includes("\\") ||
    uploadPath.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid insurer-response upload path.",
    );
  }
  return {
    byteSize: positiveInteger(value.byteSize, "insurer-response upload size"),
    contentDigest: requiredString(
      value.contentDigest,
      "insurer-response content digest",
      SHA256_PATTERN,
    ),
    documentId: requiredString(
      value.documentId,
      "insurer-response document ID",
      UUID_PATTERN,
    ),
    mediaType: insurerResponseMediaType(
      value.mediaType,
      "insurer-response upload media type",
    ),
    originalFilename: safeResponseFilename(
      value.originalFilename,
      "insurer-response upload filename",
    ),
    uploadPath,
  };
}

function mapInsurerResponseRecorded(
  value: unknown,
): TotalLossInsurerResponseRecorded {
  if (
    !isRecord(value) ||
    ![
      "insurer_response_received",
      "insurer_response_reviewing",
      "insurer_response_review_unavailable",
    ].includes(typeof value.state === "string" ? value.state : "")
  ) {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid insurer-response confirmation.",
    );
  }
  const response = mapInsurerResponse(value.response);
  if (!response) {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid insurer-response confirmation.",
    );
  }
  return {
    response,
    state: value.state as TotalLossInsurerResponseRecorded["state"],
    workflowRevision: workflowRevision(value.workflowRevision),
  };
}

function mapResponseIntake(value: unknown): TotalLossResponseIntake | null {
  if (value == null) return null;
  if (!isRecord(value)) throw new TotalLossClaimContractError("The claim service returned invalid response intake.");
  return {
    negotiationRoundId: requiredString(value.negotiationRoundId, "response intake round ID", UUID_PATTERN),
    outboundCommunicationId: requiredString(value.outboundCommunicationId, "response intake outbound ID", UUID_PATTERN),
  };
}

function mapSentCommunication(value: unknown): TotalLossSentCommunication {
  if (!isRecord(value) || value.state !== "sent") throw new TotalLossClaimContractError("The claim service returned an invalid sent message.");
  return {
    ...mapPreparedMessageVersion({ ...value, state: "prepared" }),
    state: "sent",
    customerReportedSentAt: requiredString(value.customerReportedSentAt, "message sent time", ISO_TIMESTAMP_PATTERN),
    communicationId: requiredString(value.communicationId, "message communication ID", UUID_PATTERN),
    negotiationRoundId: requiredString(value.negotiationRoundId, "message round ID", UUID_PATTERN),
  };
}

function mapNegotiationHistory(value: unknown): readonly TotalLossNegotiationHistoryRound[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TotalLossClaimContractError("The claim service returned invalid case history.");
  const roundIds = new Set<string>();
  const responseIds = new Set<string>();
  const supersededDraftIds = new Set<string>();
  return value.map((item: unknown) => {
    const round = exactRecord(item, [
      "negotiationRoundId",
      "roundNumber",
      "outbound",
      "responses",
      "followUp",
      "supersededFollowUpDrafts",
    ], "round history");
    if (!Array.isArray(round.responses) || !Array.isArray(round.supersededFollowUpDrafts) || !Number.isSafeInteger(round.roundNumber) || Number(round.roundNumber) < 1) {
      throw new TotalLossClaimContractError("The claim service returned invalid round history.");
    }
    const negotiationRoundId = requiredString(round.negotiationRoundId, "history round ID", UUID_PATTERN);
    if (roundIds.has(negotiationRoundId)) throw new TotalLossClaimContractError("The claim service returned duplicate history rounds.");
    roundIds.add(negotiationRoundId);
    const outbound = mapSentCommunication(round.outbound);
    const followUp = round.followUp == null ? null : mapSentCommunication(round.followUp);
    const responses = round.responses.map((raw: unknown) => {
      const response = mapInsurerResponse(raw);
      if (!response || response.negotiationRoundId !== negotiationRoundId || response.outboundCommunicationId !== outbound.communicationId || responseIds.has(response.responseId)) {
        throw new TotalLossClaimContractError("The saved response does not match its round and outbound message.");
      }
      responseIds.add(response.responseId);
      return response;
    });
    if (followUp && followUp.negotiationRoundId !== negotiationRoundId) throw new TotalLossClaimContractError("The saved follow-up does not match its round.");
    const correctedResponseIds = new Set(responses.map((response) => response.supersedesResponseId).filter((id): id is string => id !== null));
    const supersededSourceIds = new Set<string>();
    const supersededFollowUpDrafts = round.supersededFollowUpDrafts.map((raw: unknown): TotalLossSupersededFollowUpDraft => {
      const historical = exactRecord(raw, [
        "state",
        "sourceResponseId",
        "sourceAnalysisResultId",
        "sourceDecisionId",
        "draft",
      ], "superseded follow-up draft");
      const rawDraft = exactRecord(historical.draft, [
        "body",
        "draftId",
        "purpose",
        "recipient",
        "reportVersionId",
        "revision",
        "subject",
        "updatedAt",
      ], "superseded follow-up draft content");
      const draft = mapMessageDraft(rawDraft, "follow_up_reconsideration");
      const sourceResponseId = requiredString(historical.sourceResponseId, "superseded draft response ID", UUID_PATTERN);
      const sourceAnalysisResultId = requiredString(historical.sourceAnalysisResultId, "superseded draft analysis result ID", UUID_PATTERN);
      const sourceDecisionId = requiredString(historical.sourceDecisionId, "superseded draft decision ID", UUID_PATTERN);
      const sourceResponse = responses.find((response) => response.responseId === sourceResponseId);
      if (
        historical.state !== "superseded" ||
        !draft ||
        draft.reportVersionId !== outbound.reportVersionId ||
        !sourceResponse ||
        !correctedResponseIds.has(sourceResponseId) ||
        sourceResponse.decision?.choice !== "CONTINUE_CHALLENGING" ||
        sourceResponse.decision.decisionId !== sourceDecisionId ||
        sourceResponse.decision.analysisResultId !== sourceAnalysisResultId ||
        supersededSourceIds.has(sourceResponseId) ||
        supersededDraftIds.has(draft.draftId)
      ) {
        throw new TotalLossClaimContractError("The superseded follow-up draft does not match its saved response and decision.");
      }
      supersededSourceIds.add(sourceResponseId);
      supersededDraftIds.add(draft.draftId);
      return {
        state: "superseded",
        sourceResponseId,
        sourceAnalysisResultId,
        sourceDecisionId,
        draft,
      };
    });
    return {
      negotiationRoundId,
      roundNumber: Number(round.roundNumber),
      outbound,
      responses,
      followUp,
      supersededFollowUpDrafts,
    };
  });
}

function mapResolution(value: unknown): TotalLossCaseResolution | null {
  if (value == null) return null;
  const item = exactRecord(value, ["code", "resolvedAt", "customerConfirmed", "clientRequestId", "offerId", "amountMinorUnits", "currency", "amountSource", "recommendationId", "decisionId", "responseId"], "case resolution");
  const id = (key: string) => item[key] === null ? null : requiredString(item[key], `resolution ${key}`, UUID_PATTERN);
  const result: TotalLossCaseResolution = {
    code: enumValue(item.code, new Set<TotalLossCaseResolution["code"]>(["NO_DISPUTE_SUPPORTED", "ACCEPTED_VERIFIED_OFFER", "RESOLVED_WITH_INSURER", "CUSTOMER_STOPPED_PURSUING"]), "resolution code"),
    resolvedAt: requiredString(item.resolvedAt, "resolution time", ISO_TIMESTAMP_PATTERN),
    customerConfirmed: item.customerConfirmed === true,
    clientRequestId: id("clientRequestId"),
    offerId: id("offerId"),
    recommendationId: id("recommendationId"),
    decisionId: id("decisionId"),
    responseId: id("responseId"),
    amountMinorUnits: item.amountMinorUnits === null ? null : positiveInteger(item.amountMinorUnits, "resolution amount"),
    currency: item.currency === null ? null : requiredString(item.currency, "resolution currency", CURRENCY_PATTERN),
    amountSource: item.amountSource === null ? null : enumValue(item.amountSource, new Set<NonNullable<TotalLossCaseResolution["amountSource"]>>(["VERIFIED_INSURER_OFFER", "CUSTOMER_REPORTED"]), "resolution amount source"),
  };
  const accepted = result.code === "ACCEPTED_VERIFIED_OFFER";
  const hasAmount = result.amountMinorUnits !== null;
  if (typeof item.customerConfirmed !== "boolean" ||
    result.customerConfirmed !== (result.code !== "NO_DISPUTE_SUPPORTED") ||
    Boolean(result.clientRequestId) !== result.customerConfirmed ||
    hasAmount !== Boolean(result.currency) ||
    (accepted ? !result.offerId || !result.decisionId || !result.responseId || !result.recommendationId || !hasAmount || result.amountSource !== "VERIFIED_INSURER_OFFER"
      : result.offerId || result.decisionId || result.responseId || result.recommendationId ||
        (result.code === "RESOLVED_WITH_INSURER" ? result.amountSource !== (hasAmount ? "CUSTOMER_REPORTED" : null) : hasAmount || result.amountSource !== null))) {
    throw new TotalLossClaimContractError("The claim service returned inconsistent resolution provenance.");
  }
  return result;
}

function mapResolver(value: unknown): TotalLossClaimResolver {
  if (!isRecord(value)) {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid response.",
    );
  }
  const caseId = requiredString(value.caseId, "case ID", UUID_PATTERN);
  const commerce = mapCommerce(value.commerce, value.state);
  const education = mapEducation(value.education);
  const insurerResponse = mapInsurerResponse(value.insurerResponse);
  const followUp = mapFollowUp(value.followUp);
  const responseIntake = mapResponseIntake(value.responseIntake);
  const negotiationHistory = mapNegotiationHistory(value.negotiationHistory);
  const journey = mapJourney(value.journey);
  const messageDraft = mapMessageDraft(value.messageDraft);
  const report = mapReport(value.report);
  const sendingDetails = mapSendingDetails(value.sendingDetails);
  const workflow = mapWorkflow(value.workflow);
  const resolution = mapResolution(value.resolution);
  const extensions = {
    ...(value.education !== undefined ? { education } : {}),
    ...(value.insurerResponse !== undefined ? { insurerResponse } : {}),
    ...(value.followUp !== undefined ? { followUp } : {}),
    ...(value.responseIntake !== undefined ? { responseIntake } : {}),
    ...(value.negotiationHistory !== undefined ? { negotiationHistory } : {}),
    ...(value.journey !== undefined ? { journey } : {}),
    ...(value.messageDraft !== undefined ? { messageDraft } : {}),
    ...(value.report !== undefined ? { report } : {}),
    ...(value.sendingDetails !== undefined ? { sendingDetails } : {}),
    ...(value.resolution !== undefined ? { resolution } : {}),
  };

  if (
    value.state !== "secured" &&
    (education || insurerResponse || followUp || responseIntake || negotiationHistory.length || messageDraft || report || sendingDetails || resolution)
  ) {
    throw new TotalLossClaimContractError(
      "The claim service exposed delivery details before permanent ownership.",
    );
  }
  const responseJourneyStates = new Set([
    "insurer_response_received",
    "insurer_response_reviewing",
    "insurer_response_reviewed",
    "insurer_response_review_unavailable",
    "follow_up_preparation",
  ]);
  const responseReceivedState =
    responseJourneyStates.has(journey?.nextState ?? "") ||
    responseJourneyStates.has(journey?.fulfillmentState ?? "") ||
    responseJourneyStates.has(workflow?.currentTask ?? "");
  if (
    value.state === "secured" &&
    !resolution && (responseReceivedState || followUp?.state === "sent") !== Boolean(insurerResponse)
  ) {
    throw new TotalLossClaimContractError(
      "The claim service returned an inconsistent insurer-response state.",
    );
  }
  if (responseIntake && (journey?.nextState !== "awaiting_insurer_response" || insurerResponse?.decision?.choice === "ACCEPT_OFFER")) {
    throw new TotalLossClaimContractError("The claim service exposed response intake outside insurer waiting.");
  }
  if ((journey?.nextState === "resolved" && (!resolution || resolution.code === "NO_DISPUTE_SUPPORTED")) ||
    (resolution && (workflow?.phase !== "resolution" || responseIntake ||
      (resolution.code !== "NO_DISPUTE_SUPPORTED" && (journey?.nextState !== "resolved" || journey.fulfillmentState !== "resolved"))))) {
    throw new TotalLossClaimContractError("The claim service returned an inconsistent closed case state.");
  }
  if (resolution?.code === "ACCEPTED_VERIFIED_OFFER" && (
    insurerResponse?.responseId !== resolution.responseId ||
    insurerResponse.decision?.decisionId !== resolution.decisionId ||
    insurerResponse.decision.recommendationId !== resolution.recommendationId ||
    insurerResponse.decision.offerId !== resolution.offerId ||
    insurerResponse.decision.amountMinorUnits !== resolution.amountMinorUnits ||
    insurerResponse.decision.currency !== resolution.currency
  )) throw new TotalLossClaimContractError("The accepted resolution does not match its saved insurer offer and decision.");
  if (followUp && (
    insurerResponse?.decision?.choice !== "CONTINUE_CHALLENGING" ||
    followUp.decisionId !== insurerResponse.decision.decisionId ||
    followUp.responseId !== insurerResponse.responseId ||
    followUp.analysisResultId !== insurerResponse.decision.analysisResultId ||
    (followUp.reportVersionId !== report?.reportId && followUp.state !== "unavailable")
  )) throw new TotalLossClaimContractError("The follow-up does not match the saved response and decision.");

  if (value.state === "secure_required") {
    return {
      caseId,
      commerce,
      contactEmail: requiredString(value.contactEmail, "contact email"),
      ...extensions,
      state: "secure_required",
      workflow,
    };
  }
  if (value.state === "secured") {
    return {
      caseId,
      commerce,
      contactEmail:
        value.contactEmail === null
          ? null
          : requiredString(value.contactEmail, "contact email"),
      ...extensions,
      state: "secured",
      workflow,
    };
  }
  if (value.state === "account_switch_required") {
    if (value.contactEmail !== null) {
      throw new TotalLossClaimContractError(
        "The claim service exposed contact details for a mismatched account.",
      );
    }
    return {
      caseId,
      commerce,
      contactEmail: null,
      ...extensions,
      state: "account_switch_required",
      workflow,
    };
  }
  throw new TotalLossClaimContractError(
    "The claim service returned an unsupported access state.",
  );
}

function mapAccessLink(value: unknown): TotalLossClaimAccessLink {
  if (!isRecord(value)) {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid access-link response.",
    );
  }
  const caseId = requiredString(value.caseId, "case ID", UUID_PATTERN);
  if (
    value.state === "secured" ||
    value.state === "account_switch_required"
  ) {
    if (
      value.contactEmail !== null ||
      value.claimId !== null ||
      value.expiresAt !== null
    ) {
      throw new TotalLossClaimContractError(
        "The claim service returned invalid access-link details.",
      );
    }
    return {
      caseId,
      claimId: null,
      contactEmail: null,
      expiresAt: null,
      state: value.state,
    };
  }
  if (value.state !== "secure_required") {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid access-link response.",
    );
  }
  return {
    caseId,
    claimId: requiredString(value.claimId, "claim ID", UUID_PATTERN),
    contactEmail: requiredString(value.contactEmail, "contact email"),
    expiresAt: requiredString(
      value.expiresAt,
      "claim expiration",
      ISO_TIMESTAMP_PATTERN,
    ),
    state: "secure_required",
  };
}

function mapRecoveryAccepted(value: unknown): TotalLossClaimRecoveryAccepted {
  if (!isRecord(value) || value.status !== "accepted") {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid recovery response.",
    );
  }
  return { status: "accepted" };
}

function mapCheckout(value: unknown): TotalLossCheckoutProjection {
  if (!isRecord(value)) {
    throw new TotalLossClaimContractError(
      "The checkout service returned an invalid response.",
    );
  }
  const state = requiredString(value.state, "checkout state");
  if (!CHECKOUT_STATES.has(state as TotalLossCheckoutState)) {
    throw new TotalLossClaimContractError(
      "The checkout service returned an unsupported state.",
    );
  }
  let checkoutUrl: string | null = null;
  if (value.checkoutUrl != null) {
    const rawUrl = requiredString(value.checkoutUrl, "secure checkout URL");
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new TotalLossClaimContractError(
        "The checkout service returned an invalid secure checkout URL.",
      );
    }
    if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com") {
      throw new TotalLossClaimContractError(
        "The checkout service returned an invalid secure checkout URL.",
      );
    }
    checkoutUrl = url.toString();
  }
  const checkoutSessionId = value.checkoutSessionId == null ? null : requiredString(value.checkoutSessionId, "checkout session ID");
  const clientSecret = value.clientSecret == null ? null : requiredString(value.clientSecret, "payment initialization");
  const publishableKey = value.publishableKey == null ? null : requiredString(value.publishableKey, "payment configuration");
  const uiMode = value.uiMode == null ? null : value.uiMode;
  if (
    (clientSecret && (!checkoutSessionId || !clientSecret.startsWith(`${checkoutSessionId}_secret_`) || !publishableKey?.startsWith("pk_test_") || uiMode !== "elements" || state !== "checkout_ready")) ||
    (uiMode !== null && uiMode !== "elements") ||
    (checkoutSessionId !== null && !/^cs_test_[A-Za-z0-9_]+$/u.test(checkoutSessionId))
  ) {
    throw new TotalLossClaimContractError("The checkout service returned invalid payment initialization.");
  }
  const checkoutStatus = nullableStatus(
    value.checkoutStatus,
    "checkout status",
    CHECKOUT_STATUSES,
  );
  return {
    checkoutStatus: checkoutStatus as TotalLossCheckoutProjection["checkoutStatus"],
    checkoutUrl,
    checkoutSessionId,
    clientSecret,
    publishableKey,
    uiMode,
    entitlementStatus: nullableStatus(
      value.entitlementStatus,
      "checkout entitlement status",
      CLAIM_ENTITLEMENT_STATUSES,
    ),
    orderStatus: nullableStatus(
      value.orderStatus,
      "checkout order status",
      CLAIM_ORDER_STATUSES,
    ),
    state: state as TotalLossCheckoutState,
  };
}

function mapCheckoutQuote(value: unknown): TotalLossCheckoutQuote {
  if (!isRecord(value)) {
    throw new TotalLossClaimContractError(
      "The checkout service returned an invalid quote.",
    );
  }
  if (value.availability === "unavailable") {
    if (value.amountMinorUnits !== null || value.currency !== null) {
      throw new TotalLossClaimContractError(
        "The checkout service returned an invalid unavailable quote.",
      );
    }
    return {
      amountMinorUnits: null,
      availability: "unavailable",
      currency: null,
    };
  }
  if (
    value.availability !== "available" ||
    !Number.isSafeInteger(value.amountMinorUnits) ||
    Number(value.amountMinorUnits) < 0
  ) {
    throw new TotalLossClaimContractError(
      "The checkout service returned an invalid quote.",
    );
  }
  return {
    amountMinorUnits: Number(value.amountMinorUnits),
    availability: "available",
    currency: requiredString(
      value.currency,
      "checkout quote currency",
      CURRENCY_PATTERN,
    ),
  };
}

function mapReportList(value: unknown): readonly TotalLossPublishedReport[] {
  if (!isRecord(value) || !Array.isArray(value.reports) || value.reports.length > 1) {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid published-report list.",
    );
  }
  return value.reports.map((report) => {
    const mapped = mapReport(report);
    if (!mapped) {
      throw new TotalLossClaimContractError(
        "The claim service returned an invalid published-report list.",
      );
    }
    return mapped;
  });
}

function mapReportDownload(
  value: unknown,
  filenamePattern = SAFE_FILENAME_PATTERN,
): TotalLossReportDownload {
  if (!isRecord(value)) {
    throw new TotalLossClaimContractError(
      "The claim service returned invalid report-download details.",
    );
  }
  const rawUrl = requiredString(value.downloadUrl, "report download URL");
  let downloadUrl: URL;
  try {
    downloadUrl = new URL(rawUrl);
  } catch {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid report download URL.",
    );
  }
  const localHttp =
    downloadUrl.protocol === "http:" &&
    (downloadUrl.hostname === "localhost" || downloadUrl.hostname === "127.0.0.1");
  if (downloadUrl.protocol !== "https:" && !localHttp) {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid report download URL.",
    );
  }
  return {
    downloadUrl: downloadUrl.toString(),
    expiresAt: requiredString(
      value.expiresAt,
      "report download expiration",
      ISO_TIMESTAMP_PATTERN,
    ),
    suggestedFilename: requiredString(
      value.suggestedFilename,
      "report filename",
      filenamePattern,
    ),
  };
}

function mapPreparedMessageVersion(
  value: unknown,
): TotalLossPreparedMessageVersion {
  if (!isRecord(value) || value.state !== "prepared") {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid prepared message.",
    );
  }
  return {
    body: requiredString(value.body, "prepared message body"),
    createdAt: requiredString(
      value.createdAt,
      "prepared message creation time",
      ISO_TIMESTAMP_PATTERN,
    ),
    messageVersionId: requiredString(
      value.messageVersionId,
      "message version ID",
      UUID_PATTERN,
    ),
    recipient: requiredString(value.recipient, "prepared message recipient"),
    reportVersionId: requiredString(
      value.reportVersionId,
      "prepared report version ID",
      UUID_PATTERN,
    ),
    state: "prepared",
    subject: requiredString(value.subject, "prepared message subject"),
    versionNumber: positiveInteger(value.versionNumber, "message version number"),
  };
}

function mapPreparedMessage(value: unknown, purpose: TotalLossMessageDraft["purpose"] = "initial_reconsideration"): TotalLossPreparedMessage {
  if (!isRecord(value)) {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid prepared message.",
    );
  }
  const draft = mapMessageDraft(value.draft, purpose);
  if (!draft) {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid prepared message draft.",
    );
  }
  return {
    draft,
    messageVersion: mapPreparedMessageVersion(value.messageVersion),
    workflowRevision: workflowRevision(value.workflowRevision),
  };
}

function mapSentMessage(value: unknown): TotalLossSentMessage {
  if (!isRecord(value) || value.state !== "awaiting_insurer_response") {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid sent-message confirmation.",
    );
  }
  return {
    communicationId: requiredString(
      value.communicationId,
      "communication ID",
      UUID_PATTERN,
    ),
    customerReportedSentAt: requiredString(
      value.customerReportedSentAt,
      "customer-reported sent time",
      ISO_TIMESTAMP_PATTERN,
    ),
    messageVersionId: requiredString(
      value.messageVersionId,
      "sent message version ID",
      UUID_PATTERN,
    ),
    negotiationRoundId: requiredString(
      value.negotiationRoundId,
      "negotiation round ID",
      UUID_PATTERN,
    ),
    state: "awaiting_insurer_response",
    workflowRevision: workflowRevision(value.workflowRevision),
  };
}

function mapFollowUp(value: unknown): TotalLossFollowUp | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || !["available", "draft", "sent", "unavailable"].includes(String(value.state))) {
    throw new TotalLossClaimContractError("The claim service returned an invalid follow-up.");
  }
  const draft = mapMessageDraft(value.draft, "follow_up_reconsideration");
  const preparedMessage = value.preparedMessage == null ? null : mapPreparedMessageVersion(value.preparedMessage);
  const rawSent = value.sentMessage;
  if (rawSent != null && (!isRecord(rawSent) || rawSent.state !== "sent")) throw new TotalLossClaimContractError("The claim service returned an invalid sent follow-up.");
  const sentMessage = rawSent == null ? null : {
    ...mapPreparedMessageVersion({ ...rawSent, state: "prepared" }),
    state: "sent" as const,
    customerReportedSentAt: requiredString(isRecord(rawSent) ? rawSent.customerReportedSentAt : null, "follow-up sent time", ISO_TIMESTAMP_PATTERN),
    communicationId: requiredString(isRecord(rawSent) ? rawSent.communicationId : null, "follow-up communication ID", UUID_PATTERN),
    negotiationRoundId: requiredString(isRecord(rawSent) ? rawSent.negotiationRoundId : null, "follow-up round ID", UUID_PATTERN),
  };
  const reportVersionId = requiredString(value.reportVersionId, "follow-up report ID", UUID_PATTERN);
  if ((value.state === "sent") !== Boolean(sentMessage) ||
    ((value.state === "available" || value.state === "unavailable") && Boolean(draft || preparedMessage || sentMessage)) ||
    ((value.state === "draft" || value.state === "sent") && !draft) ||
    (draft && draft.reportVersionId !== reportVersionId) ||
    (preparedMessage && preparedMessage.reportVersionId !== reportVersionId) ||
    (sentMessage && sentMessage.reportVersionId !== reportVersionId)) {
    throw new TotalLossClaimContractError("The claim service returned an inconsistent follow-up.");
  }
  return {
    state: value.state as TotalLossFollowUp["state"],
    decisionId: requiredString(value.decisionId, "follow-up decision ID", UUID_PATTERN),
    responseId: requiredString(value.responseId, "follow-up response ID", UUID_PATTERN),
    analysisResultId: requiredString(value.analysisResultId, "follow-up analysis ID", UUID_PATTERN),
    reportVersionId, draft, preparedMessage, sentMessage,
    reasonCode: nullableString(value.reasonCode, "follow-up unavailability reason"),
  };
}

export async function getTotalLossFollowUp(caseId: string, accessToken: string) {
  ensureCaseId(caseId);
  const response = await apiClient.getAuthenticated<unknown>(`/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/follow-up`, { accessToken });
  return mapFollowUp(isRecord(response) && "followUp" in response ? response.followUp : response);
}

export async function generateTotalLossFollowUp(caseId: string, accessToken: string, decisionId: string) {
  ensureCaseId(caseId);
  const response = await apiClient.postJson<unknown>(`/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/follow-up`, { decisionId }, { accessToken });
  const followUp = mapFollowUp(isRecord(response) && "followUp" in response ? response.followUp : response);
  if (!followUp || followUp.decisionId !== decisionId) throw new TotalLossClaimContractError("The generated follow-up could not be verified.");
  return followUp;
}

function ensureCaseId(caseId: string) {
  if (!UUID_PATTERN.test(caseId)) {
    throw new TotalLossClaimContractError("A valid case ID is required.");
  }
}

export async function initializeTotalLossClaim(caseId: string, accessToken: string) {
  if (!environment.localPostContinueEnabled) {
    throw new Error("Local continuation is unavailable.");
  }
  return mapResolver(await apiClient.postAuthenticated<unknown>(
    `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/post-continue`,
    { accessToken },
  ));
}

export async function getTotalLossClaim(
  caseId: string,
  accessToken: string,
  signal?: AbortSignal,
) {
  const response = await apiClient.getAuthenticated<unknown>(claimPath(caseId), {
    accessToken,
    signal,
  });
  const result = mapResolver(response);
  if (result.caseId !== caseId) {
    throw new TotalLossClaimContractError(
      "The claim service returned a different case.",
    );
  }
  return result;
}

export async function renewTotalLossClaimAccessLink(
  caseId: string,
  accessToken: string,
  signal?: AbortSignal,
) {
  const response = await apiClient.postAuthenticated<unknown>(
    `${claimPath(caseId)}/access-link`,
    { accessToken, signal },
  );
  const result = mapAccessLink(response);
  if (result.caseId !== caseId) {
    throw new TotalLossClaimContractError(
      "The claim service returned a different case.",
    );
  }
  return result;
}

export async function requestTotalLossClaimRecovery(
  caseId: string,
  request: TotalLossClaimRecoveryRequest,
  signal?: AbortSignal,
) {
  const response = await apiClient.postJson<unknown>(
    `${claimPath(caseId)}/access-recovery`,
    request,
    { signal },
  );
  return mapRecoveryAccepted(response);
}

export async function createTotalLossCheckout(
  caseId: string,
  accessToken: string,
  clientRequestId: string,
  signal?: AbortSignal,
) {
  ensureCaseId(caseId);
  const response = await apiClient.postJson<unknown>(
    `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/checkout-sessions`,
    { clientRequestId },
    { accessToken, signal },
  );
  return mapCheckout(response);
}

export async function getTotalLossCheckoutQuote(
  caseId: string,
  accessToken: string,
  signal?: AbortSignal,
) {
  ensureCaseId(caseId);
  const response = await apiClient.getAuthenticated<unknown>(
    `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/checkout-quote`,
    { accessToken, signal },
  );
  return mapCheckoutQuote(response);
}

export async function reconcileTotalLossCheckout(
  caseId: string,
  accessToken: string,
  checkoutSessionId: string,
  signal?: AbortSignal,
) {
  ensureCaseId(caseId);
  const response = await apiClient.postJson<unknown>(
    `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/checkout-reconciliation`,
    { checkoutSessionId },
    { accessToken, signal },
  );
  return mapCheckout(response);
}

export async function updateTotalLossEducationProgress(
  caseId: string,
  accessToken: string,
  step: TotalLossEducationStep,
  state: TotalLossEducationProgressState,
  expectedWorkflowRevision: number,
  signal?: AbortSignal,
) {
  ensureCaseId(caseId);
  if (!TOTAL_LOSS_EDUCATION_STEPS.includes(step)) {
    throw new TotalLossClaimContractError("A valid education step is required.");
  }
  const response = await apiClient.putJson<unknown>(
    `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/education/${step}`,
    { expectedWorkflowRevision, state },
    { accessToken, signal },
  );
  if (!isRecord(response)) {
    throw new TotalLossClaimContractError(
      "The claim service returned invalid education progress.",
    );
  }
  return {
    education: mapEducation(response.education ?? response),
    workflowRevision:
      response.workflowRevision === undefined
        ? expectedWorkflowRevision
        : workflowRevision(response.workflowRevision),
  };
}

export async function listTotalLossPublishedReports(
  caseId: string,
  accessToken: string,
  signal?: AbortSignal,
) {
  ensureCaseId(caseId);
  const response = await apiClient.getAuthenticated<unknown>(
    `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/reports`,
    { accessToken, signal },
  );
  return mapReportList(response);
}

export async function getTotalLossPublishedReport(
  caseId: string,
  reportVersionId: string,
  accessToken: string,
  signal?: AbortSignal,
) {
  ensureCaseId(caseId);
  const response = await apiClient.getAuthenticated<unknown>(
    `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/reports/${encodeURIComponent(reportVersionId)}`,
    { accessToken, signal },
  );
  const report = mapReport(response);
  if (!report || report.reportId !== reportVersionId) {
    throw new TotalLossClaimContractError(
      "The claim service returned a different published report.",
    );
  }
  return report;
}

export async function getTotalLossReportDownload(
  caseId: string,
  reportVersionId: string,
  accessToken: string,
  signal?: AbortSignal,
) {
  ensureCaseId(caseId);
  const response = await apiClient.getAuthenticated<unknown>(
    `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/reports/${encodeURIComponent(reportVersionId)}/download`,
    { accessToken, signal },
  );
  return mapReportDownload(response);
}

export async function getTotalLossInsurerResponseDownload(
  caseId: string,
  responseId: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<TotalLossInsurerResponseDownload> {
  ensureCaseId(caseId);
  if (!UUID_PATTERN.test(responseId)) {
    throw new TotalLossClaimContractError("The insurer response ID is invalid.");
  }
  const response = await apiClient.postAuthenticated<unknown>(
    `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/claim/insurer-responses/${encodeURIComponent(responseId)}/original/download`,
    { accessToken, cache: "no-store", signal },
  );
  if (
    !isRecord(response) ||
    Object.keys(response).sort().join(",") !== "downloadUrl,expiresAt,suggestedFilename" ||
    typeof response.suggestedFilename !== "string" ||
    !/^Insurer_Response_Original\.(pdf|jpg|png|heic|heif)$/u.test(response.suggestedFilename)
  ) {
    throw new TotalLossClaimContractError(
      "The claim service returned invalid response-original download details.",
    );
  }
  const mapped = mapReportDownload(
    response, /^Insurer_Response_Original\.(pdf|jpg|png|heic|heif)$/u,
  );
  const url = new URL(mapped.downloadUrl);
  if (url.username || url.password || url.hash) {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid response-original download URL.",
    );
  }
  return mapped;
}

export async function updateTotalLossSendingDetails(
  caseId: string,
  accessToken: string,
  input: {
    readonly adjusterName: string | null;
    readonly adjusterEmail: string | null;
    readonly adjusterEmailConfirmed: boolean;
    readonly claimReference: string | null;
    readonly claimReferenceConfirmed: boolean;
    readonly expectedRevision: number;
    readonly expectedWorkflowRevision: number;
  },
  signal?: AbortSignal,
) {
  ensureCaseId(caseId);
  const response = await apiClient.putJson<unknown>(
    `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/sending-details`,
    input,
    { accessToken, signal },
  );
  if (!isRecord(response)) {
    throw new TotalLossClaimContractError(
      "The claim service returned invalid sending details.",
    );
  }
  const details = mapSendingDetails(response.sendingDetails ?? response);
  if (!details) {
    throw new TotalLossClaimContractError(
      "The claim service returned invalid sending details.",
    );
  }
  return {
    sendingDetails: details,
    workflowRevision:
      response.workflowRevision === undefined
        ? input.expectedWorkflowRevision
        : workflowRevision(response.workflowRevision),
  };
}

export async function getTotalLossMessageDraft(
  caseId: string,
  accessToken: string,
  signal?: AbortSignal,
  followUpDraftId?: string,
) {
  ensureCaseId(caseId);
  if (followUpDraftId) {
    const followUp = await getTotalLossFollowUp(caseId, accessToken);
    if (!followUp?.draft || followUp.draft.draftId !== followUpDraftId) throw new TotalLossClaimContractError("The follow-up draft is no longer current.");
    return followUp.draft;
  }
  const response = await apiClient.getAuthenticated<unknown>(
    `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/message-draft`,
    { accessToken, signal },
  );
  const draft = mapMessageDraft(
    isRecord(response) && "messageDraft" in response
      ? response.messageDraft
      : response,
  );
  if (!draft) {
    throw new TotalLossClaimContractError(
      "The claim service did not return a message draft.",
    );
  }
  return draft;
}

export async function updateTotalLossMessageDraft(
  caseId: string,
  accessToken: string,
  input: {
    readonly body: string;
    readonly expectedRevision: number;
    readonly recipient: string;
    readonly subject: string;
  },
  signal?: AbortSignal,
  followUpDraftId?: string,
) {
  ensureCaseId(caseId);
  const response = await apiClient.patchJson<unknown>(
    `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/${followUpDraftId ? "follow-up/draft" : "message-draft"}`,
    followUpDraftId ? { ...input, draftId: followUpDraftId } : input,
    { accessToken, signal },
  );
  const draft = mapMessageDraft(
    isRecord(response) && "messageDraft" in response
      ? response.messageDraft
      : response,
    followUpDraftId ? "follow_up_reconsideration" : "initial_reconsideration",
  );
  if (!draft) {
    throw new TotalLossClaimContractError(
      "The claim service did not return the saved message draft.",
    );
  }
  return draft;
}

export async function prepareTotalLossMessage(
  caseId: string,
  accessToken: string,
  clientRequestId: string,
  expectedWorkflowRevision: number,
  signal?: AbortSignal,
  followUp?: { readonly draftId: string; readonly expectedDraftRevision: number },
) {
  ensureCaseId(caseId);
  const response = await apiClient.postJson<unknown>(
    `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/${followUp ? "follow-up" : "message"}/prepare`,
    { clientRequestId, expectedWorkflowRevision, ...followUp },
    { accessToken, signal },
  );
  return mapPreparedMessage(response, followUp ? "follow_up_reconsideration" : "initial_reconsideration");
}

export async function recordTotalLossMessageOpened(
  caseId: string,
  accessToken: string,
  clientRequestId: string,
  messageVersionId: string,
  signal?: AbortSignal,
  followUpDraftId?: string,
) {
  ensureCaseId(caseId);
  return apiClient.postJson<unknown>(
    `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/${followUpDraftId ? "follow-up" : "message"}/opened`,
    { clientRequestId, messageVersionId },
    { accessToken, signal },
  );
}

export async function confirmTotalLossMessageSent(
  caseId: string,
  accessToken: string,
  input: {
    readonly clientRequestId: string;
    readonly expectedWorkflowRevision: number;
    readonly messageVersionId: string;
  },
  signal?: AbortSignal,
  followUpDraftId?: string,
) {
  ensureCaseId(caseId);
  const response = await apiClient.postJson<unknown>(
    `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/${followUpDraftId ? "follow-up" : "message"}/sent`,
    { ...input, confirmedReportAttached: true },
    { accessToken, signal },
  );
  return mapSentMessage(response);
}

export async function prepareTotalLossInsurerResponseUpload(
  caseId: string,
  accessToken: string,
  input: {
    readonly byteSize: number;
    readonly clientRequestId: string;
    readonly contentDigest: string;
    readonly expectedWorkflowRevision: number;
    readonly outboundCommunicationId: string;
    readonly supersedesResponseId: string | null;
    readonly mediaType: TotalLossInsurerResponseMediaType;
    readonly originalFilename: string;
  },
  signal?: AbortSignal,
) {
  ensureCaseId(caseId);
  const response = await apiClient.postJson<unknown>(
    `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/insurer-response/upload`,
    input,
    { accessToken, signal },
  );
  return mapInsurerResponseUploadPreparation(response);
}

export async function recordTotalLossInsurerResponse(
  caseId: string,
  accessToken: string,
  input: {
    readonly clientRequestId: string;
    readonly documentId: string | null;
    readonly expectedWorkflowRevision: number;
    readonly outboundCommunicationId: string;
    readonly responseText: string | null;
    readonly retainedDocumentId: string | null;
    readonly revisedOfferMinorUnits: number | null;
    readonly supersedesResponseId: string | null;
  },
  signal?: AbortSignal,
) {
  ensureCaseId(caseId);
  const response = await apiClient.postJson<unknown>(
    `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/insurer-response`,
    input,
    { accessToken, signal },
  );
  return mapInsurerResponseRecorded(response);
}

export async function retryTotalLossInsurerResponseAnalysis(
  caseId: string,
  accessToken: string,
  input: {
    readonly clientRequestId: string;
    readonly expectedWorkflowRevision: number;
  },
  signal?: AbortSignal,
) {
  ensureCaseId(caseId);
  const response = await apiClient.postJson<unknown>(
    `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/insurer-response-analysis/retry`,
    input,
    { accessToken, signal },
  );
  return mapResolver(response);
}

export async function resolveTotalLossCase(
  caseId: string,
  accessToken: string,
  input: TotalLossCaseResolutionInput,
): Promise<TotalLossCaseResolutionRecorded> {
  const raw = await apiClient.postJson<unknown>(
    `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/claim/resolution`, input, { accessToken },
  );
  const result = exactRecord(raw, ["state", "resolution", "workflowRevision"], "case resolution confirmation");
  const resolution = mapResolution(result.resolution);
  if (result.state !== "resolved" || !resolution || resolution.code !== input.resolutionCode ||
    resolution.clientRequestId !== input.clientRequestId || resolution.offerId !== input.offerId ||
    resolution.decisionId !== input.decisionId ||
    (input.resolutionCode !== "ACCEPTED_VERIFIED_OFFER" &&
      (resolution.amountMinorUnits !== input.amountMinorUnits || resolution.currency !== input.currency))) {
    throw new TotalLossClaimContractError("The claim service returned an inconsistent case resolution confirmation.");
  }
  return { state: "resolved", resolution, workflowRevision: workflowRevision(result.workflowRevision) };
}

export async function recordTotalLossInsurerResponseDecision(
  caseId: string,
  responseId: string,
  accessToken: string,
  input: TotalLossResponseDecisionInput,
  signal?: AbortSignal,
): Promise<TotalLossResponseDecisionRecorded> {
  ensureCaseId(caseId);
  requiredString(responseId, "insurer-response ID", UUID_PATTERN);
  const raw = await apiClient.postJson<unknown>(
    `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/claim/insurer-responses/${encodeURIComponent(responseId)}/decision`,
    input,
    { accessToken, signal },
  );
  const result = exactRecord(raw, ["state", "response", "workflowRevision"], "response decision confirmation");
  const response = mapInsurerResponse(result.response);
  if (result.state !== "insurer_response_reviewed" || response?.responseId !== responseId || !response.decision ||
    response.decision.clientRequestId !== input.clientRequestId || response.decision.recommendationId !== input.recommendationId ||
    response.decision.choice !== input.choice || response.decision.offerId !== input.offerId) {
    throw new TotalLossClaimContractError("The claim service returned an inconsistent response decision confirmation.");
  }
  return { state: "insurer_response_reviewed", response, workflowRevision: workflowRevision(result.workflowRevision) };
}
