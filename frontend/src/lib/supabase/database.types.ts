export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      analysis_runs: {
        Row: {
          analysis_run_schema_version: string;
          analysis_version: string;
          artifact: Json;
          case_id: string;
          comparable_scoring_version: string;
          created_at: string;
          discrepancy_analysis_version: string;
          id: string;
          job_id: string;
          request_digest: string;
          search_diagnostics_digest: string | null;
        };
        Insert: {
          analysis_run_schema_version: string;
          analysis_version: string;
          artifact: Json;
          case_id: string;
          comparable_scoring_version: string;
          created_at?: string;
          discrepancy_analysis_version: string;
          id: string;
          job_id: string;
          request_digest: string;
          search_diagnostics_digest?: string | null;
        };
        Update: {
          analysis_run_schema_version?: string;
          analysis_version?: string;
          artifact?: Json;
          case_id?: string;
          comparable_scoring_version?: string;
          created_at?: string;
          discrepancy_analysis_version?: string;
          id?: string;
          job_id?: string;
          request_digest?: string;
          search_diagnostics_digest?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "analysis_runs_job_identity_fkey";
            columns: ["id", "job_id", "case_id"];
            isOneToOne: true;
            referencedRelation: "total_loss_analysis_jobs";
            referencedColumns: ["run_id", "id", "case_id"];
          },
        ];
      };
      appraisal_cases: {
        Row: {
          created_at: string;
          id: string;
          last_activity_at: string;
          service_type: Database["public"]["Enums"]["appraisal_service_type"];
          status: Database["public"]["Enums"]["appraisal_case_status"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          last_activity_at?: string;
          service_type: Database["public"]["Enums"]["appraisal_service_type"];
          status?: Database["public"]["Enums"]["appraisal_case_status"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          last_activity_at?: string;
          service_type?: Database["public"]["Enums"]["appraisal_service_type"];
          status?: Database["public"]["Enums"]["appraisal_case_status"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      total_loss_analysis_jobs: {
        Row: {
          attempt_count: number;
          case_id: string;
          created_at: string;
          failure_code: string | null;
          finished_at: string | null;
          id: string;
          processing_expires_at: string | null;
          processing_token: string;
          retryable: boolean | null;
          run_id: string;
          source_details_updated_at: string;
          source_report_upload_id: string;
          status: Database["public"]["Enums"]["total_loss_analysis_status"];
          updated_at: string;
        };
        Insert: {
          attempt_count?: number;
          case_id: string;
          created_at?: string;
          failure_code?: string | null;
          finished_at?: string | null;
          id?: string;
          processing_expires_at?: string | null;
          processing_token: string;
          retryable?: boolean | null;
          run_id?: string;
          source_details_updated_at: string;
          source_report_upload_id: string;
          status?: Database["public"]["Enums"]["total_loss_analysis_status"];
          updated_at?: string;
        };
        Update: {
          attempt_count?: number;
          case_id?: string;
          created_at?: string;
          failure_code?: string | null;
          finished_at?: string | null;
          id?: string;
          processing_expires_at?: string | null;
          processing_token?: string;
          retryable?: boolean | null;
          run_id?: string;
          source_details_updated_at?: string;
          source_report_upload_id?: string;
          status?: Database["public"]["Enums"]["total_loss_analysis_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "total_loss_analysis_jobs_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "appraisal_cases";
            referencedColumns: ["id"];
          },
        ];
      };
      total_loss_case_details: {
        Row: {
          case_id: string;
          created_at: string;
          date_of_loss: string | null;
          insurer_name: string | null;
          insurer_vehicle_valuation: number | null;
          intake_completed_at: string | null;
          intake_mode: Database["public"]["Enums"]["total_loss_intake_mode"];
          mileage_at_loss: number | null;
          postal_code: string | null;
          report_original_filename: string | null;
          report_last_cancelled_upload_id: string | null;
          report_last_upload_id: string | null;
          report_upload_details_updated_at: string | null;
          report_upload_expires_at: string | null;
          report_upload_has_backup: boolean;
          report_upload_id: string | null;
          report_upload_phase: string | null;
          report_uploaded_at: string | null;
          updated_at: string;
          vehicle_make: string | null;
          vehicle_model: string | null;
          vehicle_trim: string | null;
          vehicle_year: number | null;
          vin: string | null;
        };
        Insert: {
          case_id: string;
          created_at?: string;
          date_of_loss?: string | null;
          insurer_name?: string | null;
          insurer_vehicle_valuation?: number | null;
          intake_completed_at?: string | null;
          intake_mode: Database["public"]["Enums"]["total_loss_intake_mode"];
          mileage_at_loss?: number | null;
          postal_code?: string | null;
          report_original_filename?: string | null;
          report_last_cancelled_upload_id?: string | null;
          report_last_upload_id?: string | null;
          report_upload_details_updated_at?: string | null;
          report_upload_expires_at?: string | null;
          report_upload_has_backup?: boolean;
          report_upload_id?: string | null;
          report_upload_phase?: string | null;
          report_uploaded_at?: string | null;
          updated_at?: string;
          vehicle_make?: string | null;
          vehicle_model?: string | null;
          vehicle_trim?: string | null;
          vehicle_year?: number | null;
          vin?: string | null;
        };
        Update: {
          case_id?: string;
          created_at?: string;
          date_of_loss?: string | null;
          insurer_name?: string | null;
          insurer_vehicle_valuation?: number | null;
          intake_completed_at?: string | null;
          intake_mode?: Database["public"]["Enums"]["total_loss_intake_mode"];
          mileage_at_loss?: number | null;
          postal_code?: string | null;
          report_original_filename?: string | null;
          report_last_cancelled_upload_id?: string | null;
          report_last_upload_id?: string | null;
          report_upload_details_updated_at?: string | null;
          report_upload_expires_at?: string | null;
          report_upload_has_backup?: boolean;
          report_upload_id?: string | null;
          report_upload_phase?: string | null;
          report_uploaded_at?: string | null;
          updated_at?: string;
          vehicle_make?: string | null;
          vehicle_model?: string | null;
          vehicle_trim?: string | null;
          vehicle_year?: number | null;
          vin?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "total_loss_case_details_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: true;
            referencedRelation: "appraisal_cases";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string | null;
          id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      acquire_total_loss_report_upload: {
        Args: {
          case_id: string;
          expected_updated_at: string | null;
          upload_id: string;
        };
        Returns: Database["public"]["CompositeTypes"]["total_loss_report_upload_lease"][];
      };
      authorize_total_loss_report_backup_delete: {
        Args: {
          object_name: string;
          object_user_metadata: Json;
        };
        Returns: boolean;
      };
      authorize_total_loss_report_storage_write: {
        Args: {
          object_name: string;
          object_user_metadata: Json;
        };
        Returns: boolean;
      };
      cancel_total_loss_report_upload: {
        Args: {
          case_id: string;
          upload_id: string;
        };
        Returns: Database["public"]["CompositeTypes"]["total_loss_case_details_public"][];
      };
      claim_total_loss_analysis: {
        Args: {
          case_id: string;
          processing_token: string;
          user_id: string;
        };
        Returns: Database["public"]["CompositeTypes"]["total_loss_analysis_result"][];
      };
      complete_total_loss_analysis: {
        Args: {
          artifact: Json;
          job_id: string;
          processing_token: string;
          run_id: string;
        };
        Returns: boolean;
      };
      complete_total_loss_report_upload_recovery: {
        Args: {
          case_id: string;
          upload_id: string;
        };
        Returns: Database["public"]["CompositeTypes"]["total_loss_report_upload_lease"][];
      };
      fail_total_loss_analysis: {
        Args: {
          failure_code: string;
          job_id: string;
          processing_token: string;
          retryable: boolean;
        };
        Returns: boolean;
      };
      finalize_total_loss_report_upload: {
        Args: {
          case_id: string;
          report_original_filename: string;
          report_uploaded_at: string;
          upload_id: string;
        };
        Returns: Database["public"]["CompositeTypes"]["total_loss_case_details_public"][];
      };
      get_owned_analysis_run: {
        Args: {
          run_id: string;
          user_id: string;
        };
        Returns: Json;
      };
      get_total_loss_analysis_status: {
        Args: {
          case_id: string;
          user_id: string;
        };
        Returns: Database["public"]["CompositeTypes"]["total_loss_analysis_result"][];
      };
      mark_total_loss_report_upload_ready: {
        Args: {
          case_id: string;
          has_backup: boolean;
          upload_id: string;
        };
        Returns: Database["public"]["CompositeTypes"]["total_loss_report_upload_lease"][];
      };
      renew_total_loss_report_upload: {
        Args: {
          case_id: string;
          upload_id: string;
        };
        Returns: Database["public"]["CompositeTypes"]["total_loss_report_upload_lease"][];
      };
      touch_appraisal_case: {
        Args: {
          case_id: string;
        };
        Returns: {
          created_at: string;
          id: string;
          last_activity_at: string;
          service_type: Database["public"]["Enums"]["appraisal_service_type"];
          status: Database["public"]["Enums"]["appraisal_case_status"];
          updated_at: string;
          user_id: string;
        };
      };
    };
    Enums: {
      appraisal_case_status:
        | "draft"
        | "checking"
        | "check_complete"
        | "payment_pending"
        | "paid"
        | "completed"
        | "closed";
      appraisal_service_type: "total_loss" | "diminished_value";
      total_loss_analysis_outcome:
        | "claimed"
        | "not_submitted"
        | "processing"
        | "completed"
        | "failed"
        | "not_found"
        | "report_intake_required"
        | "intake_not_ready"
        | "postal_code_required"
        | "invalid_postal_code"
        | "report_required"
        | "case_not_ready";
      total_loss_analysis_status: "processing" | "completed" | "failed";
      total_loss_intake_mode: "report" | "manual";
    };
    CompositeTypes: {
      total_loss_analysis_result: {
        attempt_count: number | null;
        failure_code: string | null;
        job_id: string | null;
        outcome: Database["public"]["Enums"]["total_loss_analysis_outcome"];
        postal_code: string | null;
        processing_expires_at: string | null;
        retryable: boolean | null;
        run_id: string | null;
        status: Database["public"]["Enums"]["total_loss_analysis_status"] | null;
      };
      total_loss_case_details_public: {
        case_id: string;
        created_at: string;
        date_of_loss: string | null;
        insurer_name: string | null;
        insurer_vehicle_valuation: number | null;
        intake_completed_at: string | null;
        intake_mode: Database["public"]["Enums"]["total_loss_intake_mode"];
        mileage_at_loss: number | null;
        postal_code: string | null;
        report_original_filename: string | null;
        report_uploaded_at: string | null;
        updated_at: string;
        vehicle_make: string | null;
        vehicle_model: string | null;
        vehicle_trim: string | null;
        vehicle_year: number | null;
        vin: string | null;
      };
      total_loss_report_upload_lease: {
        details_updated_at: string;
        expires_at: string;
        recovery_required: boolean;
        report_original_filename: string | null;
        report_uploaded_at: string | null;
        upload_id: string;
      };
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      appraisal_case_status: [
        "draft",
        "checking",
        "check_complete",
        "payment_pending",
        "paid",
        "completed",
        "closed",
      ],
      appraisal_service_type: ["total_loss", "diminished_value"],
      total_loss_analysis_outcome: [
        "claimed",
        "not_submitted",
        "processing",
        "completed",
        "failed",
        "not_found",
        "report_intake_required",
        "intake_not_ready",
        "postal_code_required",
        "invalid_postal_code",
        "report_required",
        "case_not_ready",
      ],
      total_loss_analysis_status: ["processing", "completed", "failed"],
      total_loss_intake_mode: ["report", "manual"],
    },
  },
} as const;
