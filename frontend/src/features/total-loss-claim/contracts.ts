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
  | "insurer_response_reviewing"
  | "insurer_response_reviewed"
  | "insurer_response_review_unavailable"
  | "follow_up_preparation"
  | "resolved"
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
  | "insurer_response_received"
  | "insurer_response_reviewing"
  | "insurer_response_reviewed"
  | "follow_up_preparation"
  | "resolved"
  | "insurer_response_review_unavailable";

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
  readonly purpose: "initial_reconsideration" | "follow_up_reconsideration";
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

export interface TotalLossSentCommunication extends Omit<TotalLossPreparedMessageVersion, "state"> {
  readonly state: "sent";
  readonly customerReportedSentAt: string;
  readonly communicationId: string;
  readonly negotiationRoundId: string;
}

export interface TotalLossResponseIntake {
  readonly negotiationRoundId: string;
  readonly outboundCommunicationId: string;
}

export interface TotalLossNegotiationHistoryRound {
  readonly negotiationRoundId: string;
  readonly roundNumber: number;
  readonly outbound: TotalLossSentCommunication;
  readonly responses: readonly TotalLossInsurerResponse[];
  readonly followUp: TotalLossSentCommunication | null;
}

export interface TotalLossFollowUp {
  readonly draft: TotalLossMessageDraft | null;
  readonly responseId: string;
  readonly analysisResultId: string;
  readonly decisionId: string;
  readonly reportVersionId: string;
  readonly state: "available" | "draft" | "sent" | "unavailable";
  readonly preparedMessage: TotalLossPreparedMessageVersion | null;
  readonly sentMessage: TotalLossSentCommunication | null;
  readonly reasonCode: string | null;
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

export type TotalLossInsurerResponseAnalysisConfidence =
  | "HIGH"
  | "MEDIUM"
  | "LOW";

export type TotalLossInsurerPositionCategory =
  | "REVISED_OFFER"
  | "MAINTAINS_PRIOR_POSITION"
  | "REQUESTS_MORE_INFORMATION"
  | "ACCEPTS_REQUEST"
  | "MIXED"
  | "UNCLEAR";

export type TotalLossRequestDispositionCategory =
  | "ACCEPTED"
  | "PARTIALLY_ACCEPTED"
  | "REJECTED"
  | "MORE_INFORMATION_REQUESTED"
  | "UNCLEAR";

export type TotalLossResponsePointDisposition =
  | "ACCEPTED"
  | "REJECTED"
  | "QUESTIONED"
  | "IGNORED"
  | "UNRESOLVED"
  | "UNCLEAR";

export type TotalLossResponseRecommendationCategory =
  | "REVIEW_REVISED_OFFER"
  | "MORE_INFORMATION_MAY_BE_NEEDED"
  | "FOLLOW_UP_APPEARS_WARRANTED"
  | "VALUATION_ISSUE_APPEARS_RESOLVED"
  | "REVIEW_RESPONSE";

export interface TotalLossInsurerResponseAnalysisReferenceSet {
  readonly caseEvidenceRefs: readonly string[];
  readonly responseEvidenceRefs: readonly string[];
}

export interface TotalLossInsurerResponseAnalysisSummary
  extends TotalLossInsurerResponseAnalysisReferenceSet {
  readonly whatInsurerSaid: string;
  readonly whatThisMeans: string;
}

export interface TotalLossInsurerResponseAnalysisPosition {
  readonly category: TotalLossInsurerPositionCategory;
  readonly responseEvidenceRefs: readonly string[];
  readonly summary: string;
}

export interface TotalLossInsurerResponseVisualSourceInterpretation {
  readonly confidence: "HIGH";
  readonly derivation: "MODEL_VISUAL_TRANSCRIPTION";
  readonly derivedText: string;
  readonly originalSourceAuthoritative: true;
  readonly responseEvidenceRef: string;
  readonly verificationRequired: true;
}

export interface TotalLossInsurerResponseAnalysisOffer {
  readonly amountMinorUnits: number | null;
  readonly currency: string | null;
  readonly responseEvidenceRefs: readonly string[];
  readonly source: "CUSTOMER_SUPPLIED" | "INSURER_RESPONSE" | "BOTH" | null;
  readonly status: "PRESENT" | "ABSENT" | "UNCLEAR";
  readonly visualSourceInterpretation:
    | TotalLossInsurerResponseVisualSourceInterpretation
    | null;
}

export interface TotalLossInsurerResponseAnalysisDisposition
  extends TotalLossInsurerResponseAnalysisReferenceSet {
  readonly category: TotalLossRequestDispositionCategory;
  readonly summary: string;
}

export interface TotalLossInsurerResponseAnalysisPoint
  extends TotalLossInsurerResponseAnalysisReferenceSet {
  readonly confidence: TotalLossInsurerResponseAnalysisConfidence;
  readonly disposition: TotalLossResponsePointDisposition;
  readonly topic: string;
  readonly whatInsurerSaid: string;
  readonly whatThisMeans: string;
}

export interface TotalLossInsurerResponseAnalysisArgument
  extends TotalLossInsurerResponseAnalysisReferenceSet {
  readonly argument: string;
  readonly whatItReliesOn: string;
}

export interface TotalLossInsurerResponseAnalysisIssue
  extends TotalLossInsurerResponseAnalysisReferenceSet {
  readonly description: string;
}

export interface TotalLossInsurerResponseAnalysisRecommendation
  extends TotalLossInsurerResponseAnalysisReferenceSet {
  readonly category: TotalLossResponseRecommendationCategory;
  readonly explanation: string;
}

export interface TotalLossInsurerResponseAnalysisInputCoverage {
  readonly document: "AVAILABLE" | "NOT_PROVIDED" | "UNREADABLE" | "UNSUPPORTED";
  readonly limitations: readonly string[];
  readonly pastedText: "AVAILABLE" | "NOT_PROVIDED";
}

export interface TotalLossInsurerResponseAnalysis {
  readonly analysisSummary: TotalLossInsurerResponseAnalysisSummary;
  readonly confidence: TotalLossInsurerResponseAnalysisConfidence;
  readonly importantChanges: readonly TotalLossInsurerResponseAnalysisIssue[];
  readonly inputCoverage: TotalLossInsurerResponseAnalysisInputCoverage;
  readonly insurerArguments: readonly TotalLossInsurerResponseAnalysisArgument[];
  readonly insurerPosition: TotalLossInsurerResponseAnalysisPosition;
  readonly recommendedNextStep: TotalLossInsurerResponseAnalysisRecommendation;
  readonly requestDisposition: TotalLossInsurerResponseAnalysisDisposition;
  readonly responsePoints: readonly TotalLossInsurerResponseAnalysisPoint[];
  readonly revisedOffer: TotalLossInsurerResponseAnalysisOffer;
  readonly schemaVersion: "1";
  readonly uncertainties: readonly TotalLossInsurerResponseAnalysisIssue[];
  readonly unresolvedIssues: readonly TotalLossInsurerResponseAnalysisIssue[];
  readonly untrustedInstructionDetected: boolean;
  readonly untrustedInstructionFollowed: boolean;
}

export interface TotalLossInsurerResponseAnalysisResponseEvidence {
  readonly content: string | null;
  readonly evidenceRef: string;
  readonly pageNumber: number | null;
  readonly sourceType:
    | "PASTED_TEXT"
    | "DOCUMENT"
    | "DOCUMENT_TEXT"
    | "DOCUMENT_IMAGE"
    | "CUSTOMER_SUPPLIED_OFFER";
}

export interface TotalLossInsurerResponseAnalysisCaseEvidence {
  readonly amountMinorUnits: number | null;
  readonly currency: string | null;
  readonly evidenceRef: string;
  readonly evidenceType:
    | "INSURER_VALUATION"
    | "VENFOUR_FINDING"
    | "VENFOUR_COMPARABLE"
    | "CUSTOMER_REQUEST"
    | "OTHER";
  readonly summary: string;
}

export interface TotalLossInsurerResponseAnalysisEvidence {
  readonly caseEvidence: readonly TotalLossInsurerResponseAnalysisCaseEvidence[];
  readonly responseEvidence: readonly TotalLossInsurerResponseAnalysisResponseEvidence[];
}

export type TotalLossInsurerResponseFailureReason =
  | "generic"
  | "unreadable_document"
  | "unsupported_document";

export type TotalLossResponseDecisionChoice = "ACCEPT_OFFER" | "CONTINUE_CHALLENGING";

export interface TotalLossResponseRecommendation extends TotalLossInsurerResponseAnalysisReferenceSet {
  readonly recommendationId: string;
  readonly versionNumber: number;
  readonly analysisResultId: string;
  readonly schemaVersion: "1";
  readonly policyVersion: "1" | "2";
  readonly state: TotalLossResponseDecisionChoice | "NO_CLEAR_RECOMMENDATION";
  readonly summary: string;
  readonly reasons: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly limitations: readonly string[];
}

export interface TotalLossResponseUsableOffer extends TotalLossInsurerResponseOffer {
  readonly offerId: string;
  readonly source: "CUSTOMER_RECORDED" | "RESPONSE_TEXT";
}

export interface TotalLossResponseDecision {
  readonly decisionId: string;
  readonly clientRequestId: string;
  readonly recommendationId: string;
  readonly analysisResultId: string;
  readonly choice: TotalLossResponseDecisionChoice;
  readonly offerId: string | null;
  readonly amountMinorUnits: number | null;
  readonly currency: string | null;
  readonly recordedAt: string;
}

export interface TotalLossResponseDecisionInput {
  readonly clientRequestId: string;
  readonly recommendationId: string;
  readonly choice: TotalLossResponseDecisionChoice;
  readonly offerId: string | null;
  readonly workflowRevision: number;
}

export type TotalLossResolutionCode =
  | "NO_DISPUTE_SUPPORTED"
  | "ACCEPTED_VERIFIED_OFFER"
  | "RESOLVED_WITH_INSURER"
  | "CUSTOMER_STOPPED_PURSUING";

export interface TotalLossCaseResolution {
  readonly code: TotalLossResolutionCode;
  readonly resolvedAt: string;
  readonly customerConfirmed: boolean;
  readonly clientRequestId: string | null;
  readonly offerId: string | null;
  readonly amountMinorUnits: number | null;
  readonly currency: string | null;
  readonly amountSource: "VERIFIED_INSURER_OFFER" | "CUSTOMER_REPORTED" | null;
  readonly recommendationId: string | null;
  readonly decisionId: string | null;
  readonly responseId: string | null;
}

export interface TotalLossCaseResolutionInput {
  readonly clientRequestId: string;
  readonly workflowRevision: number;
  readonly resolutionCode: Exclude<TotalLossResolutionCode, "NO_DISPUTE_SUPPORTED">;
  readonly decisionId: string | null;
  readonly offerId: string | null;
  readonly amountMinorUnits: number | null;
  readonly currency: string | null;
}

export interface TotalLossCaseResolutionRecorded {
  readonly state: "resolved";
  readonly resolution: TotalLossCaseResolution;
  readonly workflowRevision: number;
}

export interface TotalLossResponseDecisionRecorded {
  readonly state: "insurer_response_reviewed";
  readonly response: TotalLossInsurerResponse;
  readonly workflowRevision: number;
}

export interface TotalLossInsurerResponse {
  readonly negotiationRoundId?: string;
  readonly outboundCommunicationId?: string;
  readonly canCorrect?: boolean;
  readonly analysis: TotalLossInsurerResponseAnalysis | null;
  readonly analysisEvidence: TotalLossInsurerResponseAnalysisEvidence | null;
  readonly clientRequestId: string;
  readonly document: TotalLossInsurerResponseDocument | null;
  readonly failureReason: TotalLossInsurerResponseFailureReason | null;
  readonly recommendation: TotalLossResponseRecommendation | null;
  readonly usableOffer: TotalLossResponseUsableOffer | null;
  readonly decision: TotalLossResponseDecision | null;
  readonly processingState:
    | "pending"
    | "processing"
    | "completed"
    | "retryable_failed"
    | "terminal_failed"
    | "unsupported";
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
  readonly state:
    | "insurer_response_received"
    | "insurer_response_reviewing"
    | "insurer_response_review_unavailable";
  readonly workflowRevision: number;
}

export interface TotalLossReportDownload {
  readonly downloadUrl: string;
  readonly expiresAt: string;
  readonly suggestedFilename: string;
}

export interface TotalLossInsurerResponseDownload {
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
  readonly followUp?: TotalLossFollowUp | null;
  readonly responseIntake?: TotalLossResponseIntake | null;
  readonly negotiationHistory?: readonly TotalLossNegotiationHistoryRound[];
  readonly resolution?: TotalLossCaseResolution | null;
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
