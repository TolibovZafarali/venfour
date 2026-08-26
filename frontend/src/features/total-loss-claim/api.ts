import { environment } from "@/config/env";
import type {
  TotalLossClaimAccessLink,
  TotalLossClaimCommerceProjection,
  TotalLossClaimEntitlementStatus,
  TotalLossClaimOrderStatus,
  TotalLossClaimPhase,
  TotalLossClaimPaymentStatus,
  TotalLossClaimRecoveryAccepted,
  TotalLossClaimRecoveryRequest,
  TotalLossClaimResolver,
  TotalLossClaimWorkflowProjection,
} from "@/features/total-loss-claim/contracts";
import { createApiClient } from "@/lib/api/client";

const apiClient = createApiClient({ baseUrl: environment.apiBaseUrl });
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
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
  return {
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
  const workflow = mapWorkflow(value.workflow);

  if (value.state === "secure_required") {
    return {
      caseId,
      commerce,
      contactEmail: requiredString(value.contactEmail, "contact email"),
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
