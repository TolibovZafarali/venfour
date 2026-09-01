export type TotalLossClaimAccessState =
  | "account_switch_required"
  | "secure_required"
  | "secured";

export type TotalLossClaimPhase =
  | "initial_request"
  | "negotiation"
  | "resolution"
  | "review";

export interface TotalLossClaimWorkflowProjection {
  readonly currentTask: string;
  readonly phase: TotalLossClaimPhase;
  readonly revision: number;
}

export type TotalLossClaimOrderStatus =
  | "disputed"
  | "paid"
  | "partially_refunded"
  | "pending"
  | "refunded"
  | "void";

export type TotalLossClaimPaymentStatus =
  | "disputed"
  | "pending"
  | "refunded"
  | "succeeded";

export type TotalLossClaimEntitlementStatus =
  | "active"
  | "refunded_access_retained"
  | "revoked"
  | "suspended";

export interface TotalLossClaimCommerceProjection {
  readonly amountMinorUnits?: number | null;
  readonly checkoutAvailable: boolean;
  readonly currency?: string | null;
  readonly entitlementStatus: TotalLossClaimEntitlementStatus | null;
  readonly formatted?: string | null;
  readonly nextTask: string | null;
  readonly orderStatus: TotalLossClaimOrderStatus | null;
  readonly paymentStatus: TotalLossClaimPaymentStatus | null;
}

export type TotalLossClaimJourneyState =
  | "secure_claim"
  | "checkout"
  | "checkout_confirmation"
  | "processing"
  | "guide_result"
  | "guide_insurer_review"
  | "guide_valuation"
  | "guide_report"
  | "guide_what_next"
  | "prepare_request"
  | "awaiting_insurer_response"
  | "insurer_response_received"
  | "no_dispute"
  | "needs_attention";

export type TotalLossClaimFulfillmentState =
  | "not_started"
  | "payment_pending"
  | "finalizing"
  | "exception_review"
  | "report_ready"
  | "refund_pending"
  | "no_dispute"
  | "needs_attention"
  | "awaiting_insurer_response"
  | "insurer_response_received";

export interface TotalLossClaimJourneyProjection {
  readonly fulfillmentState: TotalLossClaimFulfillmentState;
  readonly nextState: TotalLossClaimJourneyState;
  readonly retryable: boolean;
}

export interface TotalLossMoney {
  readonly amountMinorUnits: number | null;
  readonly currency: string;
  readonly formatted: string;
}

export interface TotalLossSupportedRange {
  readonly evidenceBasis?: string | null;
  readonly high: TotalLossMoney;
  readonly low: TotalLossMoney;
  readonly median: TotalLossMoney;
}

export interface TotalLossPublishedReportConclusion {
  readonly classificationLabel: string;
  readonly continuingSupported: boolean;
  readonly indicatedDifference: TotalLossMoney | null;
  readonly insurerValuation: TotalLossMoney;
  readonly limitations: readonly string[];
  readonly preliminaryComparison: TotalLossPreliminaryComparison | null;
  readonly summary: string;
  readonly supportedRange: TotalLossSupportedRange | null;
}

export interface TotalLossPreliminaryComparison {
  readonly status: string;
  readonly summary: string;
}

export interface TotalLossSubjectVehicle {
  readonly description: string | null;
}

export interface TotalLossInsurerEvidence {
  readonly adjustmentContext: string | null;
  readonly comparableCount: number;
  readonly comparables: readonly TotalLossInsurerComparable[];
  readonly insurerName: string | null;
  readonly methodologyStatement: string | null;
  readonly summary: TotalLossInsurerEvidenceSummary;
}

export interface TotalLossPriceSummary {
  readonly count: number;
  readonly high: TotalLossMoney | null;
  readonly low: TotalLossMoney | null;
  readonly median: TotalLossMoney | null;
}

export interface TotalLossInsurerEvidenceSummary {
  readonly adjustedValueMissingCount: number;
  readonly adjustedValues: TotalLossPriceSummary | null;
  readonly advertisedPriceMissingCount: number;
  readonly advertisedPrices: TotalLossPriceSummary | null;
  readonly fullyDisclosedAdjustmentCount: number;
  readonly partiallyDisclosedAdjustmentCount: number;
  readonly totalCount: number;
  readonly unavailableAdjustmentCount: number;
  readonly undisclosedAdjustmentCount: number;
}

export interface TotalLossInsurerComparable {
  readonly adjustedValue: string | null;
  readonly adjustmentDisclosure: string | null;
  readonly adjustments: Readonly<{
    condition: string | null;
    mileage: string | null;
    options: string | null;
    package: string | null;
  }>;
  readonly advertisedPrice: string | null;
  readonly contributionPercent: number | null;
  readonly mileage: number | null;
  readonly netAdjustment: string | null;
  readonly vehicle: string | null;
}

export interface TotalLossMarketEvidenceSummary {
  readonly description: string | null;
  readonly evidenceDate: string | null;
  readonly label: string | null;
  readonly prices: TotalLossPriceSummary | null;
  readonly selectedCount: number;
}

export interface TotalLossMarketComparable {
  readonly advertisedPrice: string | null;
  readonly dealer: string | null;
  readonly distanceMiles: number | null;
  readonly evidenceDate: string | null;
  readonly location: string | null;
  readonly mileage: number | null;
  readonly role: string | null;
  readonly temporalBasis: string | null;
  readonly vehicle: string | null;
}

export interface TotalLossMarketEvidenceDateContext {
  readonly currentObservedDate: string | null;
  readonly historicalEvidenceDate: string | null;
  readonly lossDate: string | null;
}

export interface TotalLossMarketEvidence {
  readonly comparables: readonly TotalLossMarketComparable[];
  readonly evidenceDateContext: TotalLossMarketEvidenceDateContext;
  readonly methodologyStatement: string | null;
  readonly primary: TotalLossMarketEvidenceSummary | null;
  readonly secondary: TotalLossMarketEvidenceSummary | null;
}

export interface TotalLossPublishedReport {
  readonly conclusion: TotalLossPublishedReportConclusion;
  readonly insurerEvidence: TotalLossInsurerEvidence;
  readonly issueDate: string;
  readonly marketEvidence: TotalLossMarketEvidence;
  readonly reportId: string;
  readonly status: "published";
  readonly subjectVehicle: TotalLossSubjectVehicle;
  readonly suggestedFilename: string;
  readonly versionLabel: string;
  readonly versionNumber: number;
}

export const TOTAL_LOSS_EDUCATION_STEPS = [
  "result",
  "insurer_review",
  "valuation",
  "report",
  "what_next",
  "send",
] as const;

export type TotalLossEducationStep =
  (typeof TOTAL_LOSS_EDUCATION_STEPS)[number];
export type TotalLossEducationProgressState =
  | "viewed"
  | "completed"
  | "skipped";

export interface TotalLossEducationStepProgress {
  readonly completedAt: string | null;
  readonly skippedAt: string | null;
  readonly viewedAt: string | null;
}

export interface TotalLossEducationProjection {
  readonly reportVersionId: string;
  readonly steps: Readonly<
    Record<TotalLossEducationStep, TotalLossEducationStepProgress>
  >;
}

export interface TotalLossSendingDetails {
  readonly adjusterEmail: string | null;
  readonly adjusterEmailConfirmed: boolean;
  readonly adjusterName: string | null;
  readonly claimReference: string | null;
  readonly claimReferenceConfirmed: boolean;
  readonly customerName: string | null;
  readonly insurerName: string | null;
  readonly revision: number;
  readonly vehicleDescription: string | null;
}

export interface TotalLossMessageDraft {
  readonly body: string;
  readonly draftId: string;
  readonly purpose: "initial_reconsideration";
  readonly recipient: string | null;
  readonly reportVersionId: string;
  readonly revision: number;
  readonly subject: string;
  readonly updatedAt: string;
}

export interface TotalLossPreparedMessageVersion {
  readonly body: string;
  readonly createdAt: string;
  readonly messageVersionId: string;
  readonly recipient: string;
  readonly reportVersionId: string;
  readonly state: "prepared";
  readonly subject: string;
  readonly versionNumber: number;
}

export interface TotalLossPreparedMessage {
  readonly draft: TotalLossMessageDraft;
  readonly messageVersion: TotalLossPreparedMessageVersion;
  readonly workflowRevision: number;
}

export interface TotalLossSentMessage {
  readonly communicationId: string;
  readonly customerReportedSentAt: string;
  readonly messageVersionId: string;
  readonly negotiationRoundId: string;
  readonly state: "awaiting_insurer_response";
  readonly workflowRevision: number;
}

export const TOTAL_LOSS_INSURER_RESPONSE_MEDIA_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
] as const;

export type TotalLossInsurerResponseMediaType =
  (typeof TOTAL_LOSS_INSURER_RESPONSE_MEDIA_TYPES)[number];

export interface TotalLossInsurerResponseDocument {
  readonly byteSize: number;
  readonly documentId: string;
  readonly mediaType: TotalLossInsurerResponseMediaType;
  readonly originalFilename: string;
}

export interface TotalLossInsurerResponseOffer {
  readonly amountMinorUnits: number;
  readonly currency: string;
}

export interface TotalLossInsurerResponse {
  readonly clientRequestId: string;
  readonly document: TotalLossInsurerResponseDocument | null;
  readonly processingState: "not_started";
  readonly receivedAt: string;
  readonly responseId: string;
  readonly revisedOffer: TotalLossInsurerResponseOffer | null;
  readonly sourceType: "pasted_message" | "uploaded_document";
  readonly supersedesResponseId: string | null;
  readonly text: string | null;
}

export interface TotalLossInsurerResponseUploadPreparation {
  readonly byteSize: number;
  readonly contentDigest: string;
  readonly documentId: string;
  readonly mediaType: TotalLossInsurerResponseMediaType;
  readonly originalFilename: string;
  readonly uploadPath: string;
}

export interface TotalLossInsurerResponseRecorded {
  readonly response: TotalLossInsurerResponse;
  readonly state: "insurer_response_received";
  readonly workflowRevision: number;
}

export interface TotalLossReportDownload {
  readonly downloadUrl: string;
  readonly expiresAt: string;
  readonly suggestedFilename: string;
}

export type TotalLossCheckoutState =
  | "already_fulfilled"
  | "checkout_ready"
  | "payment_pending"
  | "reconciled";

export interface TotalLossCheckoutProjection {
  readonly checkoutStatus: "creating" | "open" | "complete" | "expired" | "failed" | null;
  readonly checkoutUrl: string | null;
  readonly checkoutSessionId: string | null;
  readonly clientSecret: string | null;
  readonly publishableKey: string | null;
  readonly uiMode: "elements" | null;
  readonly entitlementStatus: TotalLossClaimEntitlementStatus | null;
  readonly orderStatus: TotalLossClaimOrderStatus | null;
  readonly state: TotalLossCheckoutState;
}

export interface TotalLossCheckoutQuote {
  readonly amountMinorUnits: number | null;
  readonly availability: "available" | "unavailable";
  readonly currency: string | null;
}

interface TotalLossClaimResolverBase {
  readonly caseId: string;
  readonly commerce: TotalLossClaimCommerceProjection | null;
  readonly education?: TotalLossEducationProjection | null;
  readonly insurerResponse?: TotalLossInsurerResponse | null;
  readonly journey?: TotalLossClaimJourneyProjection | null;
  readonly messageDraft?: TotalLossMessageDraft | null;
  readonly report?: TotalLossPublishedReport | null;
  readonly sendingDetails?: TotalLossSendingDetails | null;
  readonly workflow: TotalLossClaimWorkflowProjection | null;
}

export interface TotalLossClaimSecureRequired
  extends TotalLossClaimResolverBase {
  readonly state: "secure_required";
  readonly contactEmail: string;
}

export interface TotalLossClaimSecured extends TotalLossClaimResolverBase {
  readonly state: "secured";
  readonly contactEmail: string | null;
}

export interface TotalLossClaimAccountSwitchRequired
  extends TotalLossClaimResolverBase {
  readonly state: "account_switch_required";
  readonly contactEmail: null;
}

export type TotalLossClaimResolver =
  | TotalLossClaimAccountSwitchRequired
  | TotalLossClaimSecureRequired
  | TotalLossClaimSecured;

export interface TotalLossClaimRenewedAccessLink {
  readonly state: "secure_required";
  readonly caseId: string;
  readonly contactEmail: string;
  readonly claimId: string;
  readonly expiresAt: string;
}

export interface TotalLossClaimAccessStateChanged {
  readonly state: "account_switch_required" | "secured";
  readonly caseId: string;
  readonly contactEmail: null;
  readonly claimId: null;
  readonly expiresAt: null;
}

export type TotalLossClaimAccessLink =
  | TotalLossClaimAccessStateChanged
  | TotalLossClaimRenewedAccessLink;

export interface TotalLossClaimRecoveryAccepted {
  readonly status: "accepted";
}

export interface TotalLossClaimRecoveryRequest {
  readonly email: string;
  readonly turnstileToken: string;
}
