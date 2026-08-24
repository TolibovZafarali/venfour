import assert from "node:assert/strict";

import {
  type CandidateRow,
  type CleanupClient,
  createCleanupHandler,
} from "./index.ts";

const SCHEDULE_SECRET = "s".repeat(32);
const SUPABASE_URL = "https://example.supabase.co";
const SERVICE_ROLE_KEY = "service-role-test-key";
const RUN_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000002";
const LEASE_TOKEN = "30000000-0000-4000-8000-000000000003";

type JsonRecord = Record<string, unknown>;
type FakeResult = { data: unknown; error: unknown };
type RpcOverride = (
  args: JsonRecord,
) => FakeResult | Promise<FakeResult>;
type StorageListOptions = {
  limit?: number;
  offset?: number;
  sortBy?: { column: string; order: string };
};
type StorageObject = { name: string; id?: string | null };

class FakeCleanupBackend {
  readonly rpcCalls: Array<{ name: string; args: JsonRecord }> = [];
  readonly listCalls: Array<{
    bucket: string;
    path: string;
    options: StorageListOptions;
  }> = [];
  readonly removeCalls: Array<{ bucket: string; paths: string[] }> = [];
  readonly getUserCalls: string[] = [];
  readonly deleteUserCalls: Array<{
    userId: string;
    shouldSoftDelete: boolean;
  }> = [];
  readonly candidates: CandidateRow[] = [];
  readonly rpcOverrides = new Map<string, RpcOverride>();

  getUserResult: FakeResult = {
    data: { user: { id: USER_ID, is_anonymous: true } },
    error: null,
  };
  deleteUserResult: FakeResult = { data: null, error: null };
  listImplementation: (
    path: string,
    options: StorageListOptions,
  ) => FakeResult | Promise<FakeResult> = () => ({ data: [], error: null });
  removeImplementation: (
    paths: string[],
  ) => FakeResult | Promise<FakeResult> = () => ({ data: [], error: null });

  readonly client = {
    rpc: async (name: string, args: JsonRecord): Promise<FakeResult> => {
      this.rpcCalls.push({ name, args });
      const override = this.rpcOverrides.get(name);
      if (override) {
        return await override(args);
      }

      switch (name) {
        case "begin_abandoned_anonymous_guest_cleanup_run":
          return {
            data: [{
              run_id: RUN_ID,
              dry_run: false,
              run_status: "running",
              eligible_count: this.candidates.length,
              marked_count: 0,
              cancelled_count: 0,
            }],
            error: null,
          };
        case "claim_abandoned_anonymous_guest_cleanup_candidate":
          return {
            data: this.candidates.length > 0 ? [this.candidates.shift()] : [],
            error: null,
          };
        case "finish_abandoned_anonymous_guest_cleanup_run": {
          const failed = args.failed === true;
          return {
            data: [{
              run_id: RUN_ID,
              run_status: failed ? "failed" : "completed",
              eligible_count: 0,
              marked_count: 0,
              cancelled_count: 0,
              claimed_count: 0,
              completed_count: 0,
              retry_count: 0,
              blocked_count: 0,
            }],
            error: null,
          };
        }
        default:
          return { data: true, error: null };
      }
    },
    storage: {
      from: (bucket: string) => ({
        list: async (
          path: string,
          options: StorageListOptions = {},
        ): Promise<FakeResult> => {
          this.listCalls.push({ bucket, path, options });
          return await this.listImplementation(path, options);
        },
        remove: async (paths: string[]): Promise<FakeResult> => {
          this.removeCalls.push({ bucket, paths: [...paths] });
          return await this.removeImplementation(paths);
        },
      }),
    },
    auth: {
      admin: {
        getUserById: (userId: string): FakeResult => {
          this.getUserCalls.push(userId);
          return this.getUserResult;
        },
        deleteUser: (
          userId: string,
          shouldSoftDelete: boolean,
        ): FakeResult => {
          this.deleteUserCalls.push({ userId, shouldSoftDelete });
          return this.deleteUserResult;
        },
      },
    },
  } as unknown as CleanupClient;
}

function createTestHandler(
  backend: FakeCleanupBackend,
  envOverrides: Record<string, string | undefined> = {},
) {
  const env: Record<string, string | undefined> = {
    VENFOUR_ANONYMOUS_CLEANUP_SCHEDULE_SECRET: SCHEDULE_SECRET,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    ...envOverrides,
  };
  const clientArguments: Array<{
    supabaseUrl: string;
    serviceRoleKey: string;
  }> = [];
  const handler = createCleanupHandler({
    getEnv: (name) => env[name],
    createCleanupClient: (supabaseUrl, serviceRoleKey) => {
      clientArguments.push({ supabaseUrl, serviceRoleKey });
      return backend.client;
    },
    randomUUID: () => LEASE_TOKEN,
  });
  return { handler, clientArguments };
}

function cleanupRequest(
  body = "{}",
  headers: Record<string, string> = {
    "x-venfour-cleanup-secret": SCHEDULE_SECRET,
  },
): Request {
  return new Request("https://cleanup.example.test/", {
    method: "POST",
    headers,
    body,
  });
}

async function responseBody(response: Response): Promise<JsonRecord> {
  return await response.json() as JsonRecord;
}

function deleteAuthCandidate(
  overrides: Partial<CandidateRow> = {},
): CandidateRow {
  return {
    user_id: USER_ID,
    cleanup_action: "delete_auth",
    case_ids: [],
    storage_prefixes: [],
    storage_object_paths: [],
    ...overrides,
  };
}

function caseId(index: number): string {
  return `40000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function deleteStorageCandidate(caseCount: number): CandidateRow {
  const caseIds = Array.from(
    { length: caseCount },
    (_, index) => caseId(index + 1),
  );
  const storagePrefixes = caseIds.map((id) => `${USER_ID}/${id}`);
  return {
    user_id: USER_ID,
    cleanup_action: "delete_storage",
    case_ids: caseIds,
    storage_prefixes: storagePrefixes,
    storage_object_paths: storagePrefixes.flatMap((prefix) => [
      `${prefix}/valuation-report-backup.pdf`,
      `${prefix}/valuation-report.pdf`,
    ]),
  };
}

Deno.test("cleanup handler authenticates only with the custom schedule header", async () => {
  const backend = new FakeCleanupBackend();
  const { handler, clientArguments } = createTestHandler(backend);

  const bearerOnlyResponse = await handler(cleanupRequest("{}", {
    authorization: `Bearer ${SCHEDULE_SECRET}`,
  }));
  assert.equal(bearerOnlyResponse.status, 401);
  assert.deepEqual(await responseBody(bearerOnlyResponse), {
    error: "UNAUTHORIZED",
  });
  assert.equal(clientArguments.length, 0);
  assert.equal(backend.rpcCalls.length, 0);

  const authorizedResponse = await handler(cleanupRequest());
  assert.equal(authorizedResponse.status, 200);
  assert.deepEqual(clientArguments, [{
    supabaseUrl: SUPABASE_URL,
    serviceRoleKey: SERVICE_ROLE_KEY,
  }]);
});

Deno.test("cleanup handler rejects oversized and malformed request bodies before client creation", async () => {
  const backend = new FakeCleanupBackend();
  const { handler, clientArguments } = createTestHandler(backend);

  const oversizedResponse = await handler(cleanupRequest(
    `"${"é".repeat(512)}"`,
  ));
  assert.equal(oversizedResponse.status, 400);
  assert.deepEqual(await responseBody(oversizedResponse), {
    error: "REQUEST_BODY_TOO_LARGE",
  });

  const unknownKeyResponse = await handler(cleanupRequest(
    JSON.stringify({ dryRun: true, unexpected: true }),
  ));
  assert.equal(unknownKeyResponse.status, 400);
  assert.deepEqual(await responseBody(unknownKeyResponse), {
    error: "INVALID_REQUEST_BODY",
  });

  const fractionalBatchResponse = await handler(cleanupRequest(
    JSON.stringify({ batchSize: 1.5 }),
  ));
  assert.equal(fractionalBatchResponse.status, 400);
  assert.deepEqual(await responseBody(fractionalBatchResponse), {
    error: "INVALID_BATCH_SIZE",
  });
  assert.equal(clientArguments.length, 0);
});

Deno.test("cleanup handler clamps request batch size to its documented bounds", async () => {
  const upperBackend = new FakeCleanupBackend();
  const { handler: upperHandler } = createTestHandler(upperBackend);
  assert.equal(
    (await upperHandler(cleanupRequest(JSON.stringify({ batchSize: 1000 }))))
      .status,
    200,
  );
  assert.equal(
    upperBackend.rpcCalls.find((call) =>
      call.name === "begin_abandoned_anonymous_guest_cleanup_run"
    )?.args.batch_size,
    100,
  );

  const lowerBackend = new FakeCleanupBackend();
  const { handler: lowerHandler } = createTestHandler(lowerBackend);
  assert.equal(
    (await lowerHandler(cleanupRequest(JSON.stringify({ batchSize: -5 }))))
      .status,
    200,
  );
  assert.equal(
    lowerBackend.rpcCalls.find((call) =>
      call.name === "begin_abandoned_anonymous_guest_cleanup_run"
    )?.args.batch_size,
    1,
  );
});

Deno.test("storage cleanup enumerates the whole user root and deletes exact snapshot paths in chunks", async () => {
  const backend = new FakeCleanupBackend();
  const candidate = deleteStorageCandidate(101);
  backend.candidates.push(candidate);
  const deletedPaths = new Set<string>();
  const rootFolderNames = candidate.case_ids;

  backend.listImplementation = (path, options) => {
    if (path === USER_ID) {
      const offset = options.offset ?? 0;
      const limit = options.limit ?? 100;
      return {
        data: rootFolderNames.slice(offset, offset + limit).map((name) => ({
          name,
          id: null,
        } satisfies StorageObject)),
        error: null,
      };
    }

    const basenames = [
      "valuation-report-backup.pdf",
      "valuation-report.pdf",
    ].filter((name) => !deletedPaths.has(`${path}/${name}`));
    return {
      data: basenames.map((name) => ({ name, id: name })),
      error: null,
    };
  };
  backend.removeImplementation = (paths) => {
    for (const path of paths) deletedPaths.add(path);
    return { data: [], error: null };
  };

  const { handler } = createTestHandler(backend);
  const response = await handler(
    cleanupRequest(JSON.stringify({ batchSize: 2 })),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    backend.listCalls.filter((call) => call.path === USER_ID).map((call) =>
      call.options.offset
    ),
    [0, 100],
  );
  assert.deepEqual(
    backend.removeCalls.map((call) => call.paths.length),
    [100, 100, 2],
  );
  assert.deepEqual(
    [...deletedPaths].sort(),
    [
      ...candidate.storage_object_paths,
    ].sort(),
  );
  assert.deepEqual(backend.deleteUserCalls, [{
    userId: USER_ID,
    shouldSoftDelete: false,
  }]);
  assert.ok(
    backend.rpcCalls.some((call) =>
      call.name === "complete_abandoned_anonymous_guest_cleanup_candidate"
    ),
  );
});

Deno.test("storage cleanup blocks an unexpected root entry found after the first page", async () => {
  const backend = new FakeCleanupBackend();
  const candidate = deleteStorageCandidate(100);
  backend.candidates.push(candidate);
  backend.listImplementation = (path, options) => {
    if (path !== USER_ID) return { data: [], error: null };
    if ((options.offset ?? 0) === 0) {
      return {
        data: candidate.case_ids.map((name) => ({ name, id: null })),
        error: null,
      };
    }
    return {
      data: [{ name: "unexpected-case-folder", id: null }],
      error: null,
    };
  };

  const { handler } = createTestHandler(backend);
  const response = await handler(
    cleanupRequest(JSON.stringify({ batchSize: 2 })),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    backend.listCalls.filter((call) => call.path === USER_ID).map((call) =>
      call.options.offset
    ),
    [0, 100],
  );
  assert.equal(backend.removeCalls.length, 0);
  assert.equal(backend.deleteUserCalls.length, 0);
  const blockCall = backend.rpcCalls.find((call) =>
    call.name === "block_abandoned_anonymous_guest_cleanup_candidate"
  );
  assert.equal(blockCall?.args.error_code, "UNEXPECTED_STORAGE_ROOT_ENTRY");
});

Deno.test("auth cleanup uses Admin Auth hard-delete and accepts deleteUser 404", async () => {
  const backend = new FakeCleanupBackend();
  backend.candidates.push(deleteAuthCandidate());
  backend.deleteUserResult = { data: null, error: { status: 404 } };

  const { handler } = createTestHandler(backend);
  const response = await handler(
    cleanupRequest(JSON.stringify({ batchSize: 2 })),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(backend.deleteUserCalls, [{
    userId: USER_ID,
    shouldSoftDelete: false,
  }]);
  assert.ok(
    backend.rpcCalls.some((call) =>
      call.name === "complete_abandoned_anonymous_guest_cleanup_candidate"
    ),
  );
  assert.ok(
    !backend.rpcCalls.some((call) =>
      call.name === "retry_abandoned_anonymous_guest_cleanup_candidate"
    ),
  );
});

Deno.test("auth cleanup accepts getUserById 404 without issuing a redundant delete", async () => {
  const backend = new FakeCleanupBackend();
  backend.candidates.push(deleteAuthCandidate());
  backend.getUserResult = {
    data: { user: null },
    error: { status: 404 },
  };

  const { handler } = createTestHandler(backend);
  const response = await handler(
    cleanupRequest(JSON.stringify({ batchSize: 2 })),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(backend.getUserCalls, [USER_ID]);
  assert.equal(backend.deleteUserCalls.length, 0);
  assert.ok(
    backend.rpcCalls.some((call) =>
      call.name === "complete_abandoned_anonymous_guest_cleanup_candidate"
    ),
  );
});

Deno.test("claim failures finalize the run as failed without leaking backend errors", async () => {
  const backend = new FakeCleanupBackend();
  backend.rpcOverrides.set(
    "claim_abandoned_anonymous_guest_cleanup_candidate",
    () => ({ data: null, error: { message: "private backend detail" } }),
  );

  const { handler } = createTestHandler(backend);
  const response = await handler(cleanupRequest());
  const body = await responseBody(response);

  assert.equal(response.status, 500);
  assert.equal(body.status, "failed");
  assert.ok(!JSON.stringify(body).includes("private backend detail"));
  const finishCall = backend.rpcCalls.find((call) =>
    call.name === "finish_abandoned_anonymous_guest_cleanup_run"
  );
  assert.equal(finishCall?.args.failed, true);
});

Deno.test("begin and finish failures return bounded orchestration errors", async () => {
  const beginBackend = new FakeCleanupBackend();
  beginBackend.rpcOverrides.set(
    "begin_abandoned_anonymous_guest_cleanup_run",
    () => ({ data: null, error: { message: "begin detail" } }),
  );
  const { handler: beginHandler } = createTestHandler(beginBackend);
  const beginResponse = await beginHandler(cleanupRequest());
  assert.equal(beginResponse.status, 500);
  assert.deepEqual(await responseBody(beginResponse), {
    error: "BEGIN_RUN_FAILED",
  });
  assert.ok(
    !beginBackend.rpcCalls.some((call) =>
      call.name === "finish_abandoned_anonymous_guest_cleanup_run"
    ),
  );

  const finishBackend = new FakeCleanupBackend();
  finishBackend.rpcOverrides.set(
    "finish_abandoned_anonymous_guest_cleanup_run",
    () => ({ data: null, error: { message: "finish detail" } }),
  );
  const { handler: finishHandler } = createTestHandler(finishBackend);
  const finishResponse = await finishHandler(cleanupRequest());
  assert.equal(finishResponse.status, 500);
  assert.deepEqual(await responseBody(finishResponse), {
    runId: RUN_ID,
    error: "FINISH_RUN_FAILED",
  });
});

Deno.test("disposition persistence failure propagates and cannot complete the run", async () => {
  const dispositionFailures: RpcOverride[] = [
    () => ({ data: null, error: { message: "disposition detail" } }),
    () => {
      throw new Error("disposition transport failure");
    },
  ];

  for (const dispositionFailure of dispositionFailures) {
    const backend = new FakeCleanupBackend();
    backend.candidates.push(
      deleteAuthCandidate({ user_id: "invalid-user-id" }),
    );
    backend.rpcOverrides.set(
      "block_abandoned_anonymous_guest_cleanup_candidate",
      dispositionFailure,
    );

    const { handler } = createTestHandler(backend);
    const response = await handler(
      cleanupRequest(JSON.stringify({ batchSize: 2 })),
    );
    const body = await responseBody(response);

    assert.equal(response.status, 500);
    assert.equal(body.status, "failed");
    assert.notEqual(body.status, "completed");
    assert.ok(
      backend.rpcCalls.some((call) =>
        call.name === "block_abandoned_anonymous_guest_cleanup_candidate" &&
        call.args.error_code === "INVALID_CANDIDATE_ID"
      ),
    );
    const finishCall = backend.rpcCalls.find((call) =>
      call.name === "finish_abandoned_anonymous_guest_cleanup_run"
    );
    assert.equal(finishCall?.args.failed, true);
  }
});
