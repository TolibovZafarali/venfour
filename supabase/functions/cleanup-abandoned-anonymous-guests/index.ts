import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2.112.3";

const CLEANUP_SECRET_HEADER = "x-venfour-cleanup-secret";
const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;
const MAX_REQUEST_BYTES = 1024;
const MAX_LISTED_STORAGE_ENTRIES = 1000;
const STORAGE_BUCKET = "case-files";
const EXPECTED_REPORT_BASENAMES = [
  "valuation-report-backup.pdf",
  "valuation-report.pdf",
] as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type JsonObject = Record<string, unknown>;

type BeginRunRow = {
  run_id: string;
  dry_run: boolean;
  run_status: string;
  eligible_count: number;
  marked_count: number;
  cancelled_count: number;
};

export type CandidateRow = {
  user_id: string;
  cleanup_action: "delete_storage" | "delete_auth";
  case_ids: string[];
  storage_prefixes: string[];
  storage_object_paths: string[];
};

type FinishRunRow = {
  run_id: string;
  run_status: string;
  eligible_count: number;
  marked_count: number;
  cancelled_count: number;
  claimed_count: number;
  completed_count: number;
  retry_count: number;
  blocked_count: number;
};

type CleanupDatabase = {
  __InternalSupabase: { PostgrestVersion: "14.15" };
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: {
      begin_abandoned_anonymous_guest_cleanup_run: {
        Args: { requested_dry_run?: boolean; batch_size?: number };
        Returns: BeginRunRow[];
      };
      block_abandoned_anonymous_guest_cleanup_candidate: {
        Args: {
          candidate_user_id: string;
          candidate_lease_token: string;
          error_code: string;
        };
        Returns: boolean;
      };
      claim_abandoned_anonymous_guest_cleanup_candidate: {
        Args: { cleanup_run_id: string; requested_lease_token: string };
        Returns: CandidateRow[];
      };
      complete_abandoned_anonymous_guest_cleanup_candidate: {
        Args: {
          candidate_user_id: string;
          candidate_lease_token: string;
        };
        Returns: boolean;
      };
      finish_abandoned_anonymous_guest_cleanup_run: {
        Args: { cleanup_run_id: string; failed?: boolean };
        Returns: FinishRunRow[];
      };
      mark_abandoned_anonymous_guest_storage_deleted: {
        Args: {
          candidate_user_id: string;
          candidate_lease_token: string;
        };
        Returns: boolean;
      };
      retry_abandoned_anonymous_guest_cleanup_candidate: {
        Args: {
          candidate_user_id: string;
          candidate_lease_token: string;
          error_code: string;
        };
        Returns: boolean;
      };
      start_abandoned_anonymous_guest_storage_deletion: {
        Args: {
          candidate_user_id: string;
          candidate_lease_token: string;
        };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type CleanupClient = SupabaseClient<CleanupDatabase>;

export type CleanupHandlerDependencies = {
  getEnv: (name: string) => string | undefined;
  createCleanupClient: (
    supabaseUrl: string,
    serviceRoleKey: string,
  ) => CleanupClient;
  randomUUID: () => string;
};

class CleanupError extends Error {
  constructor(
    readonly code: string,
    readonly disposition: "retry" | "block",
  ) {
    super(code);
  }
}

function jsonResponse(status: number, body: JsonObject): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function sha256(value: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

async function secretsMatch(
  presentedSecret: string,
  expectedSecret: string,
): Promise<boolean> {
  const [presentedDigest, expectedDigest] = await Promise.all([
    sha256(presentedSecret),
    sha256(expectedSecret),
  ]);

  let difference = 0;
  for (let index = 0; index < expectedDigest.length; index += 1) {
    difference |= presentedDigest[index] ^ expectedDigest[index];
  }

  return difference === 0;
}

async function parseRequestBody(
  request: Request,
): Promise<{ dryRun: boolean; batchSize: number }> {
  const bodyText = await request.text();
  if (new TextEncoder().encode(bodyText).byteLength > MAX_REQUEST_BYTES) {
    throw new CleanupError("REQUEST_BODY_TOO_LARGE", "block");
  }

  let body: JsonObject = {};
  if (bodyText.trim().length > 0) {
    const parsed: unknown = JSON.parse(bodyText);
    if (
      parsed === null || Array.isArray(parsed) || typeof parsed !== "object"
    ) {
      throw new CleanupError("INVALID_REQUEST_BODY", "block");
    }
    body = parsed as JsonObject;
  }

  const allowedKeys = new Set(["dryRun", "batchSize"]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new CleanupError("INVALID_REQUEST_BODY", "block");
  }

  if (body.dryRun !== undefined && typeof body.dryRun !== "boolean") {
    throw new CleanupError("INVALID_DRY_RUN", "block");
  }

  if (
    body.batchSize !== undefined &&
    (typeof body.batchSize !== "number" || !Number.isInteger(body.batchSize))
  ) {
    throw new CleanupError("INVALID_BATCH_SIZE", "block");
  }

  const requestedBatchSize = body.batchSize as number | undefined;
  return {
    dryRun: (body.dryRun as boolean | undefined) ?? false,
    batchSize: Math.max(
      1,
      Math.min(requestedBatchSize ?? DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE),
    ),
  };
}

function isNotFound(error: { status?: number } | null): boolean {
  return error?.status === 404;
}

function validateCandidateSnapshot(candidate: CandidateRow): void {
  if (!UUID_PATTERN.test(candidate.user_id)) {
    throw new CleanupError("INVALID_CANDIDATE_ID", "block");
  }

  const caseIds = new Set(candidate.case_ids);
  if (
    caseIds.size !== candidate.case_ids.length ||
    candidate.case_ids.some((caseId) => !UUID_PATTERN.test(caseId))
  ) {
    throw new CleanupError("INVALID_CASE_SNAPSHOT", "block");
  }

  const prefixes = new Set(candidate.storage_prefixes);
  if (prefixes.size !== candidate.storage_prefixes.length) {
    throw new CleanupError("DUPLICATE_STORAGE_PREFIX", "block");
  }

  for (const prefix of prefixes) {
    const [storageOwnerId, caseId, extraSegment] = prefix.split("/");
    if (
      extraSegment !== undefined ||
      storageOwnerId !== candidate.user_id ||
      !UUID_PATTERN.test(storageOwnerId) ||
      !UUID_PATTERN.test(caseId) ||
      !caseIds.has(caseId)
    ) {
      throw new CleanupError("STORAGE_OWNERSHIP_MISMATCH", "block");
    }
  }

  const expectedPaths = new Set<string>();
  for (const prefix of prefixes) {
    for (const basename of EXPECTED_REPORT_BASENAMES) {
      expectedPaths.add(`${prefix}/${basename}`);
    }
  }

  const snapshotPaths = new Set(candidate.storage_object_paths);
  if (
    snapshotPaths.size !== candidate.storage_object_paths.length ||
    snapshotPaths.size !== expectedPaths.size ||
    [...snapshotPaths].some((path) => !expectedPaths.has(path))
  ) {
    throw new CleanupError("INVALID_STORAGE_SNAPSHOT", "block");
  }
}

async function assertExpectedStorageObjects(
  supabase: CleanupClient,
  candidate: CandidateRow,
): Promise<void> {
  const expectedPaths = new Set(candidate.storage_object_paths);
  const expectedCaseFolders = new Set(
    candidate.storage_prefixes.map((prefix) => prefix.split("/")[1]),
  );

  let rootOffset = 0;
  while (rootOffset < MAX_LISTED_STORAGE_ENTRIES) {
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).list(
      candidate.user_id,
      {
        limit: 100,
        offset: rootOffset,
        sortBy: { column: "name", order: "asc" },
      },
    );

    if (error) {
      throw new CleanupError("STORAGE_LIST_FAILED", "retry");
    }

    for (const object of data ?? []) {
      const objectId = (object as { id?: string | null }).id;
      if (!expectedCaseFolders.has(object.name) || objectId != null) {
        throw new CleanupError("UNEXPECTED_STORAGE_ROOT_ENTRY", "block");
      }
    }

    if ((data ?? []).length < 100) {
      break;
    }
    rootOffset += 100;
  }

  if (rootOffset >= MAX_LISTED_STORAGE_ENTRIES) {
    throw new CleanupError("STORAGE_NAMESPACE_TOO_LARGE", "block");
  }

  for (const prefix of candidate.storage_prefixes) {
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).list(
      prefix,
      { limit: 100, offset: 0, sortBy: { column: "name", order: "asc" } },
    );

    if (error) {
      throw new CleanupError("STORAGE_LIST_FAILED", "retry");
    }

    for (const object of data ?? []) {
      if (!expectedPaths.has(`${prefix}/${object.name}`)) {
        throw new CleanupError("UNEXPECTED_STORAGE_OBJECT", "block");
      }
    }
  }
}

async function assertStorageEmpty(
  supabase: CleanupClient,
  candidate: CandidateRow,
): Promise<void> {
  for (const prefix of candidate.storage_prefixes) {
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET).list(
      prefix,
      { limit: 1, offset: 0 },
    );

    if (error) {
      throw new CleanupError("STORAGE_VERIFY_FAILED", "retry");
    }

    if ((data ?? []).length > 0) {
      throw new CleanupError("STORAGE_NOT_EMPTY", "retry");
    }
  }
}

async function deleteStorageObjects(
  supabase: CleanupClient,
  paths: string[],
): Promise<void> {
  for (let offset = 0; offset < paths.length; offset += 100) {
    const chunk = paths.slice(offset, offset + 100);
    const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(chunk);
    if (error) {
      throw new CleanupError("STORAGE_DELETE_FAILED", "retry");
    }
  }
}

async function recordDisposition(
  supabase: CleanupClient,
  candidate: CandidateRow,
  leaseToken: string,
  cleanupError: CleanupError,
): Promise<void> {
  const functionName = cleanupError.disposition === "block"
    ? "block_abandoned_anonymous_guest_cleanup_candidate"
    : "retry_abandoned_anonymous_guest_cleanup_candidate";
  let dispositionFailed = false;
  try {
    const { error } = await supabase.rpc(functionName, {
      candidate_user_id: candidate.user_id,
      candidate_lease_token: leaseToken,
      error_code: cleanupError.code,
    });
    dispositionFailed = error !== null;
  } catch {
    dispositionFailed = true;
  }

  if (dispositionFailed) {
    console.error("Anonymous cleanup disposition failed", {
      errorCode: "DISPOSITION_RPC_FAILED",
    });
    throw new CleanupError("DISPOSITION_RPC_FAILED", "retry");
  }
}

async function processCandidate(
  supabase: CleanupClient,
  candidate: CandidateRow,
  leaseToken: string,
): Promise<void> {
  try {
    validateCandidateSnapshot(candidate);

    const { data: authLookup, error: authLookupError } = await supabase.auth
      .admin.getUserById(candidate.user_id);
    const authUserMissing = isNotFound(authLookupError);

    if (authLookupError && !authUserMissing) {
      throw new CleanupError("AUTH_LOOKUP_FAILED", "retry");
    }

    if (authLookup?.user && authLookup.user.is_anonymous !== true) {
      throw new CleanupError("AUTH_USER_NOT_ANONYMOUS", "block");
    }

    if (candidate.cleanup_action === "delete_storage") {
      if (authUserMissing) {
        throw new CleanupError("AUTH_USER_MISSING_BEFORE_STORAGE", "block");
      }

      await assertExpectedStorageObjects(supabase, candidate);

      const { error: startError } = await supabase.rpc(
        "start_abandoned_anonymous_guest_storage_deletion",
        {
          candidate_user_id: candidate.user_id,
          candidate_lease_token: leaseToken,
        },
      );
      if (startError) {
        throw new CleanupError("STORAGE_START_FAILED", "retry");
      }

      await deleteStorageObjects(supabase, candidate.storage_object_paths);
      await assertStorageEmpty(supabase, candidate);

      const { error: storageCompleteError } = await supabase.rpc(
        "mark_abandoned_anonymous_guest_storage_deleted",
        {
          candidate_user_id: candidate.user_id,
          candidate_lease_token: leaseToken,
        },
      );
      if (storageCompleteError) {
        throw new CleanupError("STORAGE_COMPLETE_FAILED", "retry");
      }
    }

    if (!authUserMissing) {
      const { error: deleteUserError } = await supabase.auth.admin.deleteUser(
        candidate.user_id,
        false,
      );
      if (deleteUserError && !isNotFound(deleteUserError)) {
        throw new CleanupError("AUTH_DELETE_FAILED", "retry");
      }
    }

    const { error: completionError } = await supabase.rpc(
      "complete_abandoned_anonymous_guest_cleanup_candidate",
      {
        candidate_user_id: candidate.user_id,
        candidate_lease_token: leaseToken,
      },
    );
    if (completionError) {
      throw new CleanupError("COMPLETION_NOT_CONFIRMED", "retry");
    }

    console.info("Anonymous cleanup candidate completed");
  } catch (error) {
    const cleanupError = error instanceof CleanupError
      ? error
      : new CleanupError("UNEXPECTED_CLEANUP_ERROR", "retry");

    console.warn("Anonymous cleanup candidate deferred", {
      errorCode: cleanupError.code,
      disposition: cleanupError.disposition,
    });
    await recordDisposition(supabase, candidate, leaseToken, cleanupError);
  }
}

export async function orchestrateCleanupRun(
  supabase: CleanupClient,
  requestBody: { dryRun: boolean; batchSize: number },
  randomUUID: () => string,
): Promise<Response> {
  let beginRow: BeginRunRow;
  try {
    const { data: beginData, error: beginError } = await supabase.rpc(
      "begin_abandoned_anonymous_guest_cleanup_run",
      {
        requested_dry_run: requestBody.dryRun,
        batch_size: requestBody.batchSize,
      },
    );

    if (beginError || !Array.isArray(beginData) || beginData.length !== 1) {
      throw new CleanupError("BEGIN_RUN_FAILED", "retry");
    }
    beginRow = beginData[0] as BeginRunRow;
  } catch {
    console.error("Anonymous cleanup run could not start", {
      errorCode: "BEGIN_RUN_FAILED",
    });
    return jsonResponse(500, { error: "BEGIN_RUN_FAILED" });
  }

  if (beginRow.run_status !== "running") {
    return jsonResponse(200, {
      runId: beginRow.run_id,
      status: beginRow.run_status,
      dryRun: beginRow.dry_run,
      eligibleCount: beginRow.eligible_count,
      markedCount: beginRow.marked_count,
      cancelledCount: beginRow.cancelled_count,
      claimedCount: 0,
      completedCount: 0,
      retryCount: 0,
      blockedCount: 0,
    });
  }

  let runFailed = false;
  for (let index = 0; index < requestBody.batchSize; index += 1) {
    let leaseToken: string;
    let claimData: CandidateRow[];
    try {
      leaseToken = randomUUID();
      const { data, error } = await supabase.rpc(
        "claim_abandoned_anonymous_guest_cleanup_candidate",
        {
          cleanup_run_id: beginRow.run_id,
          requested_lease_token: leaseToken,
        },
      );

      if (error || !Array.isArray(data) || data.length > 1) {
        throw new CleanupError("CLAIM_RPC_FAILED", "retry");
      }
      claimData = data as CandidateRow[];
    } catch {
      runFailed = true;
      console.error("Anonymous cleanup candidate claim failed", {
        runId: beginRow.run_id,
        errorCode: "CLAIM_RPC_FAILED",
      });
      break;
    }

    if (claimData.length === 0) {
      break;
    }

    try {
      await processCandidate(supabase, claimData[0], leaseToken);
    } catch (error) {
      runFailed = true;
      console.error("Anonymous cleanup candidate processing failed", {
        runId: beginRow.run_id,
        errorCode: error instanceof CleanupError
          ? error.code
          : "CANDIDATE_PROCESSING_FAILED",
      });
      break;
    }
  }

  let finishRow: FinishRunRow;
  try {
    const { data: finishData, error: finishError } = await supabase.rpc(
      "finish_abandoned_anonymous_guest_cleanup_run",
      { cleanup_run_id: beginRow.run_id, failed: runFailed },
    );

    if (finishError || !Array.isArray(finishData) || finishData.length !== 1) {
      throw new CleanupError("FINISH_RUN_FAILED", "retry");
    }
    finishRow = finishData[0] as FinishRunRow;
  } catch {
    console.error("Anonymous cleanup run could not finish", {
      runId: beginRow.run_id,
      errorCode: "FINISH_RUN_FAILED",
    });
    return jsonResponse(500, {
      runId: beginRow.run_id,
      error: "FINISH_RUN_FAILED",
    });
  }

  return jsonResponse(runFailed ? 500 : 200, {
    runId: finishRow.run_id,
    status: finishRow.run_status,
    dryRun: false,
    eligibleCount: finishRow.eligible_count,
    markedCount: finishRow.marked_count,
    cancelledCount: finishRow.cancelled_count,
    claimedCount: finishRow.claimed_count,
    completedCount: finishRow.completed_count,
    retryCount: finishRow.retry_count,
    blockedCount: finishRow.blocked_count,
  });
}

export function createCleanupHandler(
  dependencies: CleanupHandlerDependencies,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
    }

    const expectedSecret = dependencies.getEnv(
      "VENFOUR_ANONYMOUS_CLEANUP_SCHEDULE_SECRET",
    );
    const presentedSecret = request.headers.get(CLEANUP_SECRET_HEADER) ?? "";
    if (!expectedSecret || expectedSecret.length < 32) {
      console.error("Anonymous cleanup configuration is incomplete", {
        errorCode: "MISSING_SCHEDULE_SECRET",
      });
      return jsonResponse(500, { error: "CLEANUP_NOT_CONFIGURED" });
    }

    if (!(await secretsMatch(presentedSecret, expectedSecret))) {
      return jsonResponse(401, { error: "UNAUTHORIZED" });
    }

    let requestBody: { dryRun: boolean; batchSize: number };
    try {
      requestBody = await parseRequestBody(request);
    } catch (error) {
      const code = error instanceof CleanupError
        ? error.code
        : "INVALID_REQUEST_BODY";
      return jsonResponse(400, { error: code });
    }

    const supabaseUrl = dependencies.getEnv("SUPABASE_URL");
    const serviceRoleKey = dependencies.getEnv("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Anonymous cleanup configuration is incomplete", {
        errorCode: "MISSING_SUPABASE_CONFIGURATION",
      });
      return jsonResponse(500, { error: "CLEANUP_NOT_CONFIGURED" });
    }

    let supabase: CleanupClient;
    try {
      supabase = dependencies.createCleanupClient(
        supabaseUrl,
        serviceRoleKey,
      );
    } catch {
      console.error("Anonymous cleanup client could not be created", {
        errorCode: "CLIENT_INITIALIZATION_FAILED",
      });
      return jsonResponse(500, { error: "CLEANUP_NOT_CONFIGURED" });
    }

    try {
      return await orchestrateCleanupRun(
        supabase,
        requestBody,
        dependencies.randomUUID,
      );
    } catch {
      console.error("Anonymous cleanup run failed unexpectedly", {
        errorCode: "CLEANUP_RUN_FAILED",
      });
      return jsonResponse(500, { error: "CLEANUP_RUN_FAILED" });
    }
  };
}

const productionDependencies: CleanupHandlerDependencies = {
  getEnv: (name) => Deno.env.get(name),
  createCleanupClient: (supabaseUrl, serviceRoleKey) =>
    createClient<CleanupDatabase>(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { "x-venfour-cleanup-worker": "1" } },
    }),
  randomUUID: () => crypto.randomUUID(),
};

if (import.meta.main) {
  Deno.serve(createCleanupHandler(productionDependencies));
}
