import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AppraisalCase,
  CreateAppraisalCaseInput,
  CreateOrGetAppraisalCaseInput,
  GetAppraisalCaseInput,
  GetOrCreateTotalLossDraftInput,
  GetRecentDraftAppraisalCaseInput,
  TouchAppraisalCaseInput,
} from "@/features/cases/types";
import type { Database, Tables } from "@/lib/supabase/database.types";

const APPRAISAL_CASE_COLUMNS =
  "id,user_id,service_type,status,created_at,updated_at,last_activity_at" as const;

type AppraisalCaseRow = Tables<"appraisal_cases">;
type OwnedCaseOperationRow =
  Database["public"]["Functions"]["list_owned_case_operations"]["Returns"][number];
type OwnedCaseOperationRowWithClaimResume = OwnedCaseOperationRow & {
  readonly claim_resume_task?: string | null;
};

export interface AppraisalCaseService {
  createAppraisalCase(input: CreateAppraisalCaseInput): Promise<AppraisalCase>;
  createOrGetAppraisalCase(
    input: CreateOrGetAppraisalCaseInput,
  ): Promise<AppraisalCase>;
  listAppraisalCases(userId: string): Promise<AppraisalCase[]>;
  getRecentDraftAppraisalCase(
    input: GetRecentDraftAppraisalCaseInput,
  ): Promise<AppraisalCase | null>;
  getOrCreateTotalLossDraft(
    input: GetOrCreateTotalLossDraftInput,
  ): Promise<AppraisalCase>;
  getAppraisalCase(input: GetAppraisalCaseInput): Promise<AppraisalCase | null>;
  touchAppraisalCase(
    input: TouchAppraisalCaseInput,
  ): Promise<AppraisalCase | null>;
}

export class AppraisalCaseResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppraisalCaseResponseError";
  }
}

function mapAppraisalCase(row: AppraisalCaseRow): AppraisalCase {
  return {
    id: row.id,
    userId: row.user_id,
    serviceType: row.service_type,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivityAt: row.last_activity_at,
  };
}

function mapOwnedCaseOperation(
  row: OwnedCaseOperationRowWithClaimResume,
): AppraisalCase {
  return {
    id: row.case_id,
    userId: row.owner_user_id,
    serviceType: row.service_type,
    status: row.case_status,
    caseStage: row.case_stage,
    ...(row.claim_resume_task !== undefined
      ? { claimResumeTask: row.claim_resume_task }
      : {}),
    needsAttention: row.needs_attention,
    createdAt: row.case_created_at,
    updatedAt: row.case_updated_at,
    lastActivityAt: row.last_activity_at,
    reportUploadedAt: row.report_uploaded_at,
    analysisStatus: row.analysis_status,
    analysisAttemptCount: row.analysis_attempt_count,
    analysisRetryable: row.analysis_retryable,
    analysisFailureCode: row.analysis_failure_code,
    analysisProcessingExpiresAt: row.analysis_processing_expires_at,
  };
}

function assertOwnedCase(
  appraisalCase: AppraisalCase,
  expectedUserId: string,
  expectedCaseId?: string,
) {
  if (
    appraisalCase.userId !== expectedUserId ||
    (expectedCaseId !== undefined && appraisalCase.id !== expectedCaseId)
  ) {
    throw new AppraisalCaseResponseError(
      "Supabase returned an appraisal case outside the requested ownership scope.",
    );
  }
}

function assertExpectedDraftCase(
  appraisalCase: AppraisalCase,
  input: CreateOrGetAppraisalCaseInput | GetRecentDraftAppraisalCaseInput,
) {
  assertOwnedCase(
    appraisalCase,
    input.userId,
    "caseId" in input ? input.caseId : undefined,
  );

  if (
    appraisalCase.serviceType !== input.serviceType ||
    appraisalCase.status !== "draft"
  ) {
    throw new AppraisalCaseResponseError(
      "Supabase returned an appraisal case outside the requested draft workflow.",
    );
  }
}

async function fetchOwnedCase(
  client: SupabaseClient<Database>,
  { userId, caseId }: GetAppraisalCaseInput,
): Promise<AppraisalCase | null> {
  const { data, error } = await client
    .from("appraisal_cases")
    .select(APPRAISAL_CASE_COLUMNS)
    .eq("user_id", userId)
    .eq("id", caseId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!data) {
    return null;
  }

  const appraisalCase = mapAppraisalCase(data);
  assertOwnedCase(appraisalCase, userId, caseId);
  return appraisalCase;
}

export function createAppraisalCaseService(
  client: SupabaseClient<Database>,
): AppraisalCaseService {
  return {
    async createAppraisalCase({ userId, serviceType }) {
      const { data, error } = await client
        .from("appraisal_cases")
        .insert({
          user_id: userId,
          service_type: serviceType,
        })
        .select(APPRAISAL_CASE_COLUMNS)
        .single();

      if (error) {
        throw error;
      }
      if (!data) {
        throw new AppraisalCaseResponseError(
          "Supabase did not return the created appraisal case.",
        );
      }

      const appraisalCase = mapAppraisalCase(data);
      assertOwnedCase(appraisalCase, userId);
      return appraisalCase;
    },

    async createOrGetAppraisalCase({ caseId, userId, serviceType }) {
      const { data, error } = await client
        .from("appraisal_cases")
        .insert({
          id: caseId,
          user_id: userId,
          service_type: serviceType,
        })
        .select(APPRAISAL_CASE_COLUMNS)
        .single();

      if (!error && data) {
        const appraisalCase = mapAppraisalCase(data);
        assertExpectedDraftCase(appraisalCase, {
          caseId,
          userId,
          serviceType,
        });
        return appraisalCase;
      }

      // A stable browser-reserved ID makes retries idempotent. Fetching after
      // any failed response covers both a primary-key conflict and a request
      // whose insert committed before the connection was lost.
      const existingCase = await fetchOwnedCase(client, { caseId, userId });
      if (existingCase) {
        assertExpectedDraftCase(existingCase, {
          caseId,
          userId,
          serviceType,
        });
        return existingCase;
      }

      if (error) {
        throw error;
      }

      throw new AppraisalCaseResponseError(
        "Supabase did not return the created appraisal case.",
      );
    },

    async listAppraisalCases(userId) {
      const { data, error } = await client.rpc("list_owned_case_operations");

      if (error) {
        throw error;
      }
      if (!data) {
        throw new AppraisalCaseResponseError(
          "Supabase did not return an appraisal-case list.",
        );
      }

      return data.map((row) => {
        const appraisalCase = mapOwnedCaseOperation(row);
        assertOwnedCase(appraisalCase, userId);
        return appraisalCase;
      });
    },

    async getRecentDraftAppraisalCase({ userId, serviceType }) {
      const { data, error } = await client
        .from("appraisal_cases")
        .select(APPRAISAL_CASE_COLUMNS)
        .eq("user_id", userId)
        .eq("service_type", serviceType)
        .eq("status", "draft")
        .order("last_activity_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw error;
      }
      if (!data) {
        return null;
      }

      const appraisalCase = mapAppraisalCase(data);
      assertExpectedDraftCase(appraisalCase, { userId, serviceType });
      return appraisalCase;
    },

    async getOrCreateTotalLossDraft({ userId }) {
      const { data, error } = await client.rpc(
        "get_or_create_total_loss_draft",
      );

      if (error) throw error;
      if (!data) {
        throw new AppraisalCaseResponseError(
          "Supabase did not return the Total Loss draft.",
        );
      }

      const appraisalCase = mapAppraisalCase(data);
      assertOwnedCase(appraisalCase, userId);
      if (
        appraisalCase.serviceType !== "total_loss" ||
        appraisalCase.status !== "draft"
      ) {
        throw new AppraisalCaseResponseError(
          "Supabase returned a case outside the requested Total Loss draft workflow.",
        );
      }
      return appraisalCase;
    },

    async getAppraisalCase({ userId, caseId }) {
      return fetchOwnedCase(client, { userId, caseId });
    },

    async touchAppraisalCase({ userId, caseId }) {
      const { data, error } = await client.rpc("touch_appraisal_case", {
        case_id: caseId,
      });

      if (error) {
        throw error;
      }
      if (!data) {
        return null;
      }

      const appraisalCase = mapAppraisalCase(data);
      assertOwnedCase(appraisalCase, userId, caseId);
      return appraisalCase;
    },
  };
}
