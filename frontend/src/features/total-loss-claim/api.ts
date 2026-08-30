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
  TotalLossCheckoutProjection,
  TotalLossCheckoutQuote,
  TotalLossCheckoutState,
  TotalLossEducationProgressState,
  TotalLossEducationProjection,
  TotalLossEducationStep,
  TotalLossEducationStepProgress,
  TotalLossInsurerEvidence,
  TotalLossInsurerComparable,
  TotalLossInsurerEvidenceSummary,
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
  TotalLossSupportedRange,
} from "@/features/total-loss-claim/contracts";
import { TOTAL_LOSS_EDUCATION_STEPS } from "@/features/total-loss-claim/contracts";
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
const CURRENCY_PATTERN = /^[A-Z]{3}$/u;
const JOURNEY_STATES = new Set<TotalLossClaimJourneyState>([
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
  "no_dispute",
  "needs_attention",
]);
const FULFILLMENT_STATES = new Set<TotalLossClaimFulfillmentState>([
  "not_started",
  "payment_pending",
  "finalizing",
  "exception_review",
  "report_ready",
  "refund_pending",
  "no_dispute",
  "needs_attention",
  "awaiting_insurer_response",
]);
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

function mapMessageDraft(value: unknown): TotalLossMessageDraft | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || value.purpose !== "initial_reconsideration") {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid message draft.",
    );
  }
  return {
    body: typeof value.body === "string" ? value.body : requiredString(value.body, "draft body"),
    draftId: requiredString(value.draftId, "draft ID", UUID_PATTERN),
    purpose: "initial_reconsideration",
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

function mapResolver(value: unknown): TotalLossClaimResolver {
  if (!isRecord(value)) {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid response.",
    );
  }
  const caseId = requiredString(value.caseId, "case ID", UUID_PATTERN);
  const commerce = mapCommerce(value.commerce, value.state);
  const education = mapEducation(value.education);
  const journey = mapJourney(value.journey);
  const messageDraft = mapMessageDraft(value.messageDraft);
  const report = mapReport(value.report);
  const sendingDetails = mapSendingDetails(value.sendingDetails);
  const workflow = mapWorkflow(value.workflow);
  const extensions = {
    ...(value.education !== undefined ? { education } : {}),
    ...(value.journey !== undefined ? { journey } : {}),
    ...(value.messageDraft !== undefined ? { messageDraft } : {}),
    ...(value.report !== undefined ? { report } : {}),
    ...(value.sendingDetails !== undefined ? { sendingDetails } : {}),
  };

  if (
    value.state !== "secured" &&
    (education || messageDraft || report || sendingDetails)
  ) {
    throw new TotalLossClaimContractError(
      "The claim service exposed delivery details before permanent ownership.",
    );
  }

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

function mapReportDownload(value: unknown): TotalLossReportDownload {
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
      SAFE_FILENAME_PATTERN,
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

function mapPreparedMessage(value: unknown): TotalLossPreparedMessage {
  if (!isRecord(value)) {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid prepared message.",
    );
  }
  const draft = mapMessageDraft(value.draft);
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
) {
  ensureCaseId(caseId);
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
) {
  ensureCaseId(caseId);
  const response = await apiClient.patchJson<unknown>(
    `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/message-draft`,
    input,
    { accessToken, signal },
  );
  const draft = mapMessageDraft(
    isRecord(response) && "messageDraft" in response
      ? response.messageDraft
      : response,
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
) {
  ensureCaseId(caseId);
  const response = await apiClient.postJson<unknown>(
    `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/message/prepare`,
    { clientRequestId, expectedWorkflowRevision },
    { accessToken, signal },
  );
  return mapPreparedMessage(response);
}

export async function recordTotalLossMessageOpened(
  caseId: string,
  accessToken: string,
  clientRequestId: string,
  messageVersionId: string,
  signal?: AbortSignal,
) {
  ensureCaseId(caseId);
  return apiClient.postJson<unknown>(
    `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/message/opened`,
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
) {
  ensureCaseId(caseId);
  const response = await apiClient.postJson<unknown>(
    `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/message/sent`,
    { ...input, confirmedReportAttached: true },
    { accessToken, signal },
  );
  return mapSentMessage(response);
}
