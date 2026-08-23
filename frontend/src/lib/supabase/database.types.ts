export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
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
            isOneToOne: false;
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
      diminished_value_case_details: {
        Row: {
          accident_date: string | null;
          accident_state: string | null;
          airbag_deployment: string | null;
          at_fault_insurer: string | null;
          availability: string | null;
          case_id: string;
          created_at: string;
          current_mileage: number | null;
          draft_step: string;
          email: string | null;
          full_name: string | null;
          major_repair_details: string | null;
          mileage_at_accident: number | null;
          notes: string | null;
          other_party_at_fault: string | null;
          phone: string | null;
          preferred_contact_method: string | null;
          repair_cost: number | null;
          repair_facility: string | null;
          repair_status: string | null;
          revision: number;
          structural_damage: string | null;
          submitted_at: string | null;
          updated_at: string;
          vehicle_entry_method: string;
          vehicle_make: string | null;
          vehicle_model: string | null;
          vehicle_trim: string | null;
          vehicle_year: number | null;
          vin: string | null;
        };
        Insert: {
          accident_date?: string | null;
          accident_state?: string | null;
          airbag_deployment?: string | null;
          at_fault_insurer?: string | null;
          availability?: string | null;
          case_id: string;
          created_at?: string;
          current_mileage?: number | null;
          draft_step?: string;
          email?: string | null;
          full_name?: string | null;
          major_repair_details?: string | null;
          mileage_at_accident?: number | null;
          notes?: string | null;
          other_party_at_fault?: string | null;
          phone?: string | null;
          preferred_contact_method?: string | null;
          repair_cost?: number | null;
          repair_facility?: string | null;
          repair_status?: string | null;
          revision?: number;
          structural_damage?: string | null;
          submitted_at?: string | null;
          updated_at?: string;
          vehicle_entry_method?: string;
          vehicle_make?: string | null;
          vehicle_model?: string | null;
          vehicle_trim?: string | null;
          vehicle_year?: number | null;
          vin?: string | null;
        };
        Update: {
          accident_date?: string | null;
          accident_state?: string | null;
          airbag_deployment?: string | null;
          at_fault_insurer?: string | null;
          availability?: string | null;
          case_id?: string;
          created_at?: string;
          current_mileage?: number | null;
          draft_step?: string;
          email?: string | null;
          full_name?: string | null;
          major_repair_details?: string | null;
          mileage_at_accident?: number | null;
          notes?: string | null;
          other_party_at_fault?: string | null;
          phone?: string | null;
          preferred_contact_method?: string | null;
          repair_cost?: number | null;
          repair_facility?: string | null;
          repair_status?: string | null;
          revision?: number;
          structural_damage?: string | null;
          submitted_at?: string | null;
          updated_at?: string;
          vehicle_entry_method?: string;
          vehicle_make?: string | null;
          vehicle_model?: string | null;
          vehicle_trim?: string | null;
          vehicle_year?: number | null;
          vin?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "diminished_value_case_details_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: true;
            referencedRelation: "appraisal_cases";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "diminished_value_case_details_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: true;
            referencedRelation: "total_loss_case_operations_internal";
            referencedColumns: ["case_id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string | null;
          full_name_confirmed_at: string | null;
          id: string;
          operational_follow_up_allowed: boolean | null;
          operational_follow_up_updated_at: string | null;
          privacy_notice_acknowledged_at: string | null;
          privacy_notice_version: string | null;
          service_terms_acknowledged_at: string | null;
          service_terms_version: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          full_name_confirmed_at?: string | null;
          id: string;
          operational_follow_up_allowed?: boolean | null;
          operational_follow_up_updated_at?: string | null;
          privacy_notice_acknowledged_at?: string | null;
          privacy_notice_version?: string | null;
          service_terms_acknowledged_at?: string | null;
          service_terms_version?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          full_name_confirmed_at?: string | null;
          id?: string;
          operational_follow_up_allowed?: boolean | null;
          operational_follow_up_updated_at?: string | null;
          privacy_notice_acknowledged_at?: string | null;
          privacy_notice_version?: string | null;
          service_terms_acknowledged_at?: string | null;
          service_terms_version?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      staff_members: {
        Row: {
          granted_at: string;
          user_id: string;
        };
        Insert: {
          granted_at?: string;
          user_id: string;
        };
        Update: {
          granted_at?: string;
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
          {
            foreignKeyName: "total_loss_analysis_jobs_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: false;
            referencedRelation: "total_loss_case_operations_internal";
            referencedColumns: ["case_id"];
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
          report_last_cancelled_upload_id: string | null;
          report_last_upload_id: string | null;
          report_original_filename: string | null;
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
          report_last_cancelled_upload_id?: string | null;
          report_last_upload_id?: string | null;
          report_original_filename?: string | null;
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
          report_last_cancelled_upload_id?: string | null;
          report_last_upload_id?: string | null;
          report_original_filename?: string | null;
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
          {
            foreignKeyName: "total_loss_case_details_case_id_fkey";
            columns: ["case_id"];
            isOneToOne: true;
            referencedRelation: "total_loss_case_operations_internal";
            referencedColumns: ["case_id"];
          },
        ];
      };
    };
    Views: {
      total_loss_case_operations_internal: {
        Row: {
          analysis_attempt_count: number | null;
          analysis_classification: string | null;
          analysis_evidence_basis: string | null;
          analysis_evidence_strength: string | null;
          analysis_failure_code: string | null;
          analysis_job_created_at: string | null;
          analysis_job_finished_at: string | null;
          analysis_job_id: string | null;
          analysis_job_updated_at: string | null;
          analysis_processing_expires_at: string | null;
          analysis_retryable: boolean | null;
          analysis_run_created_at: string | null;
          analysis_run_id: string | null;
          analysis_run_schema_version: string | null;
          analysis_status:
            | Database["public"]["Enums"]["total_loss_analysis_status"]
            | null;
          analysis_version: string | null;
          canonical_report_available: boolean | null;
          case_created_at: string | null;
          case_id: string | null;
          case_stage:
            | Database["public"]["Enums"]["case_operation_stage"]
            | null;
          case_status:
            | Database["public"]["Enums"]["appraisal_case_status"]
            | null;
          case_updated_at: string | null;
          comparable_scoring_version: string | null;
          customer_full_name: string | null;
          date_of_loss: string | null;
          details_created_at: string | null;
          details_updated_at: string | null;
          discrepancy_analysis_version: string | null;
          insurer_name: string | null;
          insurer_vehicle_valuation: number | null;
          intake_completed_at: string | null;
          intake_mode:
            | Database["public"]["Enums"]["total_loss_intake_mode"]
            | null;
          last_activity_at: string | null;
          mileage_at_loss: number | null;
          operational_follow_up_allowed: boolean | null;
          owner_user_id: string | null;
          postal_code: string | null;
          report_last_upload_id: string | null;
          report_original_filename: string | null;
          report_upload_expires_at: string | null;
          report_upload_id: string | null;
          report_uploaded_at: string | null;
          service_type:
            | Database["public"]["Enums"]["appraisal_service_type"]
            | null;
          vehicle_make: string | null;
          vehicle_model: string | null;
          vehicle_trim: string | null;
          vehicle_year: number | null;
          verified_email: string | null;
          vin: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      acquire_total_loss_report_upload: {
        Args: {
          case_id: string;
          expected_updated_at: string;
          upload_id: string;
        };
        Returns: Database["public"]["CompositeTypes"]["total_loss_report_upload_lease"][];
        SetofOptions: {
          from: "*";
          to: "total_loss_report_upload_lease";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      authorize_diminished_value_document_mutation: {
        Args: { object_name: string };
        Returns: boolean;
      };
      authorize_staff_diminished_value_document_read: {
        Args: { object_name: string };
        Returns: boolean;
      };
      authorize_total_loss_report_backup_delete: {
        Args: { object_name: string; object_user_metadata: Json };
        Returns: boolean;
      };
      authorize_total_loss_report_storage_write: {
        Args: { object_name: string; object_user_metadata: Json };
        Returns: boolean;
      };
      cancel_total_loss_report_upload: {
        Args: { case_id: string; upload_id: string };
        Returns: Database["public"]["CompositeTypes"]["total_loss_case_details_public"][];
        SetofOptions: {
          from: "*";
          to: "total_loss_case_details_public";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      claim_total_loss_analysis: {
        Args: { case_id: string; processing_token: string; user_id: string };
        Returns: Database["public"]["CompositeTypes"]["total_loss_analysis_result"][];
        SetofOptions: {
          from: "*";
          to: "total_loss_analysis_result";
          isOneToOne: false;
          isSetofReturn: true;
        };
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
        Args: { case_id: string; upload_id: string };
        Returns: Database["public"]["CompositeTypes"]["total_loss_report_upload_lease"][];
        SetofOptions: {
          from: "*";
          to: "total_loss_report_upload_lease";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      confirm_customer_profile: {
        Args: {
          full_name: string;
          operational_follow_up_allowed: boolean;
          privacy_notice_version: string;
          service_terms_version: string;
        };
        Returns: {
          created_at: string;
          display_name: string | null;
          full_name_confirmed_at: string | null;
          id: string;
          operational_follow_up_allowed: boolean | null;
          operational_follow_up_updated_at: string | null;
          privacy_notice_acknowledged_at: string | null;
          privacy_notice_version: string | null;
          service_terms_acknowledged_at: string | null;
          service_terms_version: string | null;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "profiles";
          isOneToOne: true;
          isSetofReturn: false;
        };
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
        SetofOptions: {
          from: "*";
          to: "total_loss_case_details_public";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      get_or_create_total_loss_draft: {
        Args: never;
        Returns: {
          created_at: string;
          id: string;
          last_activity_at: string;
          service_type: Database["public"]["Enums"]["appraisal_service_type"];
          status: Database["public"]["Enums"]["appraisal_case_status"];
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "appraisal_cases";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      get_owned_analysis_run: {
        Args: { run_id: string; user_id: string };
        Returns: Json;
      };
      get_submitted_diminished_value_case: {
        Args: { requested_case_id: string };
        Returns: {
          accident_date: string;
          accident_state: string;
          airbag_deployment: string;
          at_fault_insurer: string;
          availability: string;
          case_id: string;
          created_at: string;
          current_mileage: number;
          draft_step: string;
          email: string;
          full_name: string;
          major_repair_details: string;
          mileage_at_accident: number;
          notes: string;
          other_party_at_fault: string;
          owner_user_id: string;
          phone: string;
          preferred_contact_method: string;
          repair_cost: number;
          repair_facility: string;
          repair_status: string;
          revision: number;
          service_type: Database["public"]["Enums"]["appraisal_service_type"];
          status: Database["public"]["Enums"]["appraisal_case_status"];
          structural_damage: string;
          submitted_at: string;
          updated_at: string;
          vehicle_entry_method: string;
          vehicle_make: string;
          vehicle_model: string;
          vehicle_trim: string;
          vehicle_year: number;
          vin: string;
        }[];
      };
      get_total_loss_analysis_status: {
        Args: { case_id: string; user_id: string };
        Returns: Database["public"]["CompositeTypes"]["total_loss_analysis_result"][];
        SetofOptions: {
          from: "*";
          to: "total_loss_analysis_result";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      has_current_customer_profile: { Args: never; Returns: boolean };
      is_venfour_staff: { Args: never; Returns: boolean };
      list_owned_case_operations: {
        Args: never;
        Returns: {
          analysis_attempt_count: number;
          analysis_failure_code: string;
          analysis_processing_expires_at: string;
          analysis_retryable: boolean;
          analysis_status: Database["public"]["Enums"]["total_loss_analysis_status"];
          case_created_at: string;
          case_id: string;
          case_stage: Database["public"]["Enums"]["case_operation_stage"];
          case_status: Database["public"]["Enums"]["appraisal_case_status"];
          case_updated_at: string;
          last_activity_at: string;
          needs_attention: boolean;
          owner_user_id: string;
          report_uploaded_at: string;
          service_type: Database["public"]["Enums"]["appraisal_service_type"];
        }[];
      };
      list_submitted_diminished_value_cases: {
        Args: never;
        Returns: {
          accident_date: string;
          at_fault_insurer: string;
          case_id: string;
          document_count: number;
          email: string;
          full_name: string;
          owner_user_id: string;
          phone: string;
          preferred_contact_method: string;
          service_type: Database["public"]["Enums"]["appraisal_service_type"];
          status: Database["public"]["Enums"]["appraisal_case_status"];
          submitted_at: string;
          vehicle_make: string;
          vehicle_model: string;
          vehicle_year: number;
        }[];
      };
      mark_total_loss_report_upload_ready: {
        Args: { case_id: string; has_backup: boolean; upload_id: string };
        Returns: Database["public"]["CompositeTypes"]["total_loss_report_upload_lease"][];
        SetofOptions: {
          from: "*";
          to: "total_loss_report_upload_lease";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      renew_total_loss_report_upload: {
        Args: { case_id: string; upload_id: string };
        Returns: Database["public"]["CompositeTypes"]["total_loss_report_upload_lease"][];
        SetofOptions: {
          from: "*";
          to: "total_loss_report_upload_lease";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      staff_get_total_loss_case_operation: {
        Args: { requested_case_id: string };
        Returns: {
          analysis_attempt_count: number;
          analysis_classification: string;
          analysis_evidence_basis: string;
          analysis_evidence_strength: string;
          analysis_failure_code: string;
          analysis_job_created_at: string;
          analysis_job_finished_at: string;
          analysis_job_id: string;
          analysis_job_updated_at: string;
          analysis_processing_expires_at: string;
          analysis_retryable: boolean;
          analysis_run_created_at: string;
          analysis_run_id: string;
          analysis_run_schema_version: string;
          analysis_status: Database["public"]["Enums"]["total_loss_analysis_status"];
          analysis_version: string;
          case_created_at: string;
          case_id: string;
          case_stage: Database["public"]["Enums"]["case_operation_stage"];
          case_status: Database["public"]["Enums"]["appraisal_case_status"];
          case_updated_at: string;
          comparable_scoring_version: string;
          customer_full_name: string;
          date_of_loss: string;
          details_created_at: string;
          details_updated_at: string;
          discrepancy_analysis_version: string;
          insurer_name: string;
          insurer_vehicle_valuation: number;
          intake_completed_at: string;
          intake_mode: Database["public"]["Enums"]["total_loss_intake_mode"];
          last_activity_at: string;
          mileage_at_loss: number;
          needs_attention: boolean;
          operational_follow_up_allowed: boolean;
          owner_user_id: string;
          postal_code: string;
          report_original_filename: string;
          report_uploaded_at: string;
          service_type: Database["public"]["Enums"]["appraisal_service_type"];
          vehicle_make: string;
          vehicle_model: string;
          vehicle_trim: string;
          vehicle_year: number;
          verified_email: string;
          vin: string;
        }[];
      };
      staff_list_case_operations: {
        Args: never;
        Returns: {
          analysis_attempt_count: number;
          analysis_failure_code: string;
          analysis_processing_expires_at: string;
          analysis_retryable: boolean;
          analysis_status: Database["public"]["Enums"]["total_loss_analysis_status"];
          case_created_at: string;
          case_id: string;
          case_stage: Database["public"]["Enums"]["case_operation_stage"];
          case_status: Database["public"]["Enums"]["appraisal_case_status"];
          case_updated_at: string;
          customer_full_name: string;
          last_activity_at: string;
          needs_attention: boolean;
          owner_user_id: string;
          report_uploaded_at: string;
          service_type: Database["public"]["Enums"]["appraisal_service_type"];
          verified_email: string;
        }[];
      };
      submit_diminished_value_case: {
        Args: { case_id: string };
        Returns: Database["public"]["CompositeTypes"]["diminished_value_submission_result"][];
        SetofOptions: {
          from: "*";
          to: "diminished_value_submission_result";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      touch_appraisal_case: {
        Args: { case_id: string };
        Returns: {
          created_at: string;
          id: string;
          last_activity_at: string;
          service_type: Database["public"]["Enums"]["appraisal_service_type"];
          status: Database["public"]["Enums"]["appraisal_case_status"];
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "appraisal_cases";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      appraisal_case_status:
        | "draft"
        | "submitted"
        | "checking"
        | "check_complete"
        | "payment_pending"
        | "paid"
        | "completed"
        | "closed";
      appraisal_service_type: "total_loss" | "diminished_value";
      case_operation_stage:
        | "intake_not_started"
        | "intake_in_progress"
        | "report_uploaded"
        | "report_required"
        | "ready_for_analysis"
        | "analysis_processing"
        | "analysis_failed"
        | "analysis_complete"
        | "submitted"
        | "closed"
        | "needs_attention";
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
      diminished_value_submission_result: {
        case_id: string | null;
        status: Database["public"]["Enums"]["appraisal_case_status"] | null;
        submitted_at: string | null;
        revision: number | null;
      };
      total_loss_analysis_result: {
        outcome:
          | Database["public"]["Enums"]["total_loss_analysis_outcome"]
          | null;
        job_id: string | null;
        status:
          | Database["public"]["Enums"]["total_loss_analysis_status"]
          | null;
        attempt_count: number | null;
        run_id: string | null;
        postal_code: string | null;
        failure_code: string | null;
        retryable: boolean | null;
        processing_expires_at: string | null;
      };
      total_loss_case_details_public: {
        case_id: string | null;
        intake_mode:
          | Database["public"]["Enums"]["total_loss_intake_mode"]
          | null;
        vin: string | null;
        vehicle_year: number | null;
        vehicle_make: string | null;
        vehicle_model: string | null;
        vehicle_trim: string | null;
        mileage_at_loss: number | null;
        postal_code: string | null;
        date_of_loss: string | null;
        insurer_name: string | null;
        insurer_vehicle_valuation: number | null;
        report_original_filename: string | null;
        report_uploaded_at: string | null;
        intake_completed_at: string | null;
        created_at: string | null;
        updated_at: string | null;
      };
      total_loss_report_upload_lease: {
        upload_id: string | null;
        expires_at: string | null;
        details_updated_at: string | null;
        report_original_filename: string | null;
        report_uploaded_at: string | null;
        recovery_required: boolean | null;
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

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      appraisal_case_status: [
        "draft",
        "submitted",
        "checking",
        "check_complete",
        "payment_pending",
        "paid",
        "completed",
        "closed",
      ],
      appraisal_service_type: ["total_loss", "diminished_value"],
      case_operation_stage: [
        "intake_not_started",
        "intake_in_progress",
        "report_uploaded",
        "report_required",
        "ready_for_analysis",
        "analysis_processing",
        "analysis_failed",
        "analysis_complete",
        "submitted",
        "closed",
        "needs_attention",
      ],
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
