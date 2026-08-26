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

interface TotalLossClaimResolverBase {
  readonly caseId: string;
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
