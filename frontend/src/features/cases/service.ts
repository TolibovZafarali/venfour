import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AppraisalCase,
  CreateAppraisalCaseInput,
  GetAppraisalCaseInput,
  TouchAppraisalCaseInput,
} from "@/features/cases/types";
import type { Database, Tables } from "@/lib/supabase/database.types";

const APPRAISAL_CASE_COLUMNS =
  "id,user_id,service_type,status,created_at,updated_at,last_activity_at" as const;

type AppraisalCaseRow = Tables<"appraisal_cases">;

export interface AppraisalCaseService {
  createAppraisalCase(input: CreateAppraisalCaseInput): Promise<AppraisalCase>;
  listAppraisalCases(userId: string): Promise<AppraisalCase[]>;
  getAppraisalCase(
    input: GetAppraisalCaseInput,
  ): Promise<AppraisalCase | null>;
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

    async listAppraisalCases(userId) {
      const { data, error } = await client
        .from("appraisal_cases")
        .select(APPRAISAL_CASE_COLUMNS)
        .eq("user_id", userId)
        .order("last_activity_at", { ascending: false });

      if (error) {
        throw error;
      }
      if (!data) {
        throw new AppraisalCaseResponseError(
          "Supabase did not return an appraisal-case list.",
        );
      }

      return data.map((row) => {
        const appraisalCase = mapAppraisalCase(row);
        assertOwnedCase(appraisalCase, userId);
        return appraisalCase;
      });
    },

    async getAppraisalCase({ userId, caseId }) {
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
