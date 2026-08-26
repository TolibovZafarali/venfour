import { environment } from "@/config/env";
import type {
  TotalLossClaimAccessLink,
  TotalLossClaimPhase,
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
    !/^[a-z][a-z0-9_]{0,63}$/u.test(currentTask) ||
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

function mapResolver(value: unknown): TotalLossClaimResolver {
  if (!isRecord(value)) {
    throw new TotalLossClaimContractError(
      "The claim service returned an invalid response.",
    );
  }
  const caseId = requiredString(value.caseId, "case ID", UUID_PATTERN);
  const workflow = mapWorkflow(value.workflow);

  if (value.state === "secure_required") {
    return {
      caseId,
      contactEmail: requiredString(value.contactEmail, "contact email"),
      state: "secure_required",
      workflow,
    };
  }
  if (value.state === "secured") {
    return {
      caseId,
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
