export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      analysis_runs: {
        Row: {
          analysis_run_schema_version: string
          analysis_version: string
          artifact: Json
          case_id: string
          comparable_scoring_version: string
          created_at: string
          discrepancy_analysis_version: string
          id: string
          job_id: string
          request_digest: string
          search_diagnostics_digest: string | null
        }
        Insert: {
          analysis_run_schema_version: string
          analysis_version: string
          artifact: Json
          case_id: string
          comparable_scoring_version: string
          created_at?: string
          discrepancy_analysis_version: string
          id: string
          job_id: string
          request_digest: string
          search_diagnostics_digest?: string | null
        }
        Update: {
          analysis_run_schema_version?: string
          analysis_version?: string
          artifact?: Json
          case_id?: string
          comparable_scoring_version?: string
          created_at?: string
          discrepancy_analysis_version?: string
          id?: string
          job_id?: string
          request_digest?: string
          search_diagnostics_digest?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analysis_runs_job_identity_fkey"
            columns: ["id", "job_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_analysis_jobs"
            referencedColumns: ["run_id", "id", "case_id"]
          },
        ]
      }
      anonymous_guest_cleanup_candidates: {
        Row: {
          attempt_count: number
          auth_deleted_at: string | null
          case_ids: string[]
          completed_at: string | null
          delete_after: string
          eligibility_checked_at: string
          first_marked_at: string
          last_error_code: string | null
          last_run_id: string | null
          lease_expires_at: string | null
          lease_token: string | null
          retry_after: string | null
          snapshot_at: string | null
          state: string
          storage_deleted_at: string | null
          storage_deletion_started_at: string | null
          storage_object_paths: string[]
          storage_prefixes: string[]
          user_id: string
        }
        Insert: {
          attempt_count?: number
          auth_deleted_at?: string | null
          case_ids?: string[]
          completed_at?: string | null
          delete_after: string
          eligibility_checked_at: string
          first_marked_at: string
          last_error_code?: string | null
          last_run_id?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          retry_after?: string | null
          snapshot_at?: string | null
          state: string
          storage_deleted_at?: string | null
          storage_deletion_started_at?: string | null
          storage_object_paths?: string[]
          storage_prefixes?: string[]
          user_id: string
        }
        Update: {
          attempt_count?: number
          auth_deleted_at?: string | null
          case_ids?: string[]
          completed_at?: string | null
          delete_after?: string
          eligibility_checked_at?: string
          first_marked_at?: string
          last_error_code?: string | null
          last_run_id?: string | null
          lease_expires_at?: string | null
          lease_token?: string | null
          retry_after?: string | null
          snapshot_at?: string | null
          state?: string
          storage_deleted_at?: string | null
          storage_deletion_started_at?: string | null
          storage_object_paths?: string[]
          storage_prefixes?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "anonymous_guest_cleanup_candidates_last_run_id_fkey"
            columns: ["last_run_id"]
            isOneToOne: false
            referencedRelation: "anonymous_guest_cleanup_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      anonymous_guest_cleanup_events: {
        Row: {
          created_at: string
          details: Json
          event_type: string
          id: number
          run_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          details?: Json
          event_type: string
          id?: never
          run_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          details?: Json
          event_type?: string
          id?: never
          run_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "anonymous_guest_cleanup_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "anonymous_guest_cleanup_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      anonymous_guest_cleanup_runs: {
        Row: {
          blocked_count: number
          cancelled_count: number
          claimed_count: number
          completed_at: string | null
          completed_count: number
          dry_run: boolean
          eligible_count: number
          id: string
          marked_count: number
          requested_batch_size: number
          retry_count: number
          started_at: string
          status: string
        }
        Insert: {
          blocked_count?: number
          cancelled_count?: number
          claimed_count?: number
          completed_at?: string | null
          completed_count?: number
          dry_run: boolean
          eligible_count?: number
          id?: string
          marked_count?: number
          requested_batch_size: number
          retry_count?: number
          started_at?: string
          status?: string
        }
        Update: {
          blocked_count?: number
          cancelled_count?: number
          claimed_count?: number
          completed_at?: string | null
          completed_count?: number
          dry_run?: boolean
          eligible_count?: number
          id?: string
          marked_count?: number
          requested_batch_size?: number
          retry_count?: number
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      anonymous_guest_cleanup_scheduler_config: {
        Row: {
          configured_at: string
          project_origin: string
          singleton: boolean
        }
        Insert: {
          configured_at?: string
          project_origin: string
          singleton?: boolean
        }
        Update: {
          configured_at?: string
          project_origin?: string
          singleton?: boolean
        }
        Relationships: []
      }
      appraisal_cases: {
        Row: {
          created_at: string
          id: string
          last_activity_at: string
          service_type: Database["public"]["Enums"]["appraisal_service_type"]
          status: Database["public"]["Enums"]["appraisal_case_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_activity_at?: string
          service_type: Database["public"]["Enums"]["appraisal_service_type"]
          status?: Database["public"]["Enums"]["appraisal_case_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_activity_at?: string
          service_type?: Database["public"]["Enums"]["appraisal_service_type"]
          status?: Database["public"]["Enums"]["appraisal_case_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      case_entitlements: {
        Row: {
          case_id: string
          created_at: string
          granted_at: string
          id: string
          order_id: string
          preliminary_snapshot_id: string
          product_identifier: string
          product_version: string
          reason_code: string | null
          revoked_at: string | null
          status: Database["public"]["Enums"]["case_entitlement_status"]
          status_changed_at: string
          updated_at: string
        }
        Insert: {
          case_id: string
          created_at?: string
          granted_at?: string
          id?: string
          order_id: string
          preliminary_snapshot_id: string
          product_identifier: string
          product_version: string
          reason_code?: string | null
          revoked_at?: string | null
          status?: Database["public"]["Enums"]["case_entitlement_status"]
          status_changed_at?: string
          updated_at?: string
        }
        Update: {
          case_id?: string
          created_at?: string
          granted_at?: string
          id?: string
          order_id?: string
          preliminary_snapshot_id?: string
          product_identifier?: string
          product_version?: string
          reason_code?: string | null
          revoked_at?: string | null
          status?: Database["public"]["Enums"]["case_entitlement_status"]
          status_changed_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_entitlements_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "appraisal_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_entitlements_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_case_operations_internal"
            referencedColumns: ["case_id"]
          },
          {
            foreignKeyName: "case_entitlements_order_identity_fkey"
            columns: [
              "order_id",
              "case_id",
              "preliminary_snapshot_id",
              "product_identifier",
              "product_version",
            ]
            isOneToOne: false
            referencedRelation: "commerce_orders"
            referencedColumns: [
              "id",
              "case_id",
              "preliminary_snapshot_id",
              "product_identifier",
              "product_version",
            ]
          },
          {
            foreignKeyName: "case_entitlements_snapshot_case_fkey"
            columns: ["preliminary_snapshot_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_preliminary_snapshots"
            referencedColumns: ["id", "case_id"]
          },
        ]
      }
      checkout_attempts: {
        Row: {
          amount_minor_units: number
          case_id: string
          client_request_id: string
          created_at: string
          currency: string
          expires_at: string | null
          external_checkout_session_id: string | null
          external_customer_id: string | null
          external_payment_intent_id: string | null
          failure_code: string | null
          finished_at: string | null
          id: string
          order_id: string
          payment_provider: string
          status: string
          updated_at: string
        }
        Insert: {
          amount_minor_units: number
          case_id: string
          client_request_id: string
          created_at?: string
          currency: string
          expires_at?: string | null
          external_checkout_session_id?: string | null
          external_customer_id?: string | null
          external_payment_intent_id?: string | null
          failure_code?: string | null
          finished_at?: string | null
          id?: string
          order_id: string
          payment_provider: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount_minor_units?: number
          case_id?: string
          client_request_id?: string
          created_at?: string
          currency?: string
          expires_at?: string | null
          external_checkout_session_id?: string | null
          external_customer_id?: string | null
          external_payment_intent_id?: string | null
          failure_code?: string | null
          finished_at?: string | null
          id?: string
          order_id?: string
          payment_provider?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checkout_attempts_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "appraisal_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checkout_attempts_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_case_operations_internal"
            referencedColumns: ["case_id"]
          },
          {
            foreignKeyName: "checkout_attempts_order_amount_fkey"
            columns: ["order_id", "case_id", "amount_minor_units", "currency"]
            isOneToOne: false
            referencedRelation: "commerce_orders"
            referencedColumns: [
              "id",
              "case_id",
              "amount_minor_units",
              "currency",
            ]
          },
        ]
      }
      commerce_orders: {
        Row: {
          amount_minor_units: number
          case_id: string
          created_at: string
          currency: string
          external_price_identifier: string | null
          id: string
          paid_at: string | null
          payment_provider: string | null
          preliminary_snapshot_id: string
          product_identifier: string
          product_version: string
          purchaser_user_id: string
          refund_policy_version: string
          refunded_at: string | null
          status: Database["public"]["Enums"]["commerce_order_status"]
          terms_version: string
          updated_at: string
        }
        Insert: {
          amount_minor_units: number
          case_id: string
          created_at?: string
          currency: string
          external_price_identifier?: string | null
          id?: string
          paid_at?: string | null
          payment_provider?: string | null
          preliminary_snapshot_id: string
          product_identifier: string
          product_version: string
          purchaser_user_id: string
          refund_policy_version: string
          refunded_at?: string | null
          status?: Database["public"]["Enums"]["commerce_order_status"]
          terms_version: string
          updated_at?: string
        }
        Update: {
          amount_minor_units?: number
          case_id?: string
          created_at?: string
          currency?: string
          external_price_identifier?: string | null
          id?: string
          paid_at?: string | null
          payment_provider?: string | null
          preliminary_snapshot_id?: string
          product_identifier?: string
          product_version?: string
          purchaser_user_id?: string
          refund_policy_version?: string
          refunded_at?: string | null
          status?: Database["public"]["Enums"]["commerce_order_status"]
          terms_version?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commerce_orders_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "appraisal_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commerce_orders_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_case_operations_internal"
            referencedColumns: ["case_id"]
          },
          {
            foreignKeyName: "commerce_orders_snapshot_case_fkey"
            columns: ["preliminary_snapshot_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_preliminary_snapshots"
            referencedColumns: ["id", "case_id"]
          },
        ]
      }
      diminished_value_case_details: {
        Row: {
          accident_date: string | null
          accident_state: string | null
          airbag_deployment: string | null
          at_fault_insurer: string | null
          availability: string | null
          case_id: string
          created_at: string
          current_mileage: number | null
          draft_step: string
          email: string | null
          full_name: string | null
          major_repair_details: string | null
          mileage_at_accident: number | null
          notes: string | null
          other_party_at_fault: string | null
          phone: string | null
          preferred_contact_method: string | null
          repair_cost: number | null
          repair_facility: string | null
          repair_status: string | null
          revision: number
          structural_damage: string | null
          submitted_at: string | null
          updated_at: string
          vehicle_configuration: Json | null
          vehicle_entry_method: string
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_trim: string | null
          vehicle_year: number | null
          vin: string | null
        }
        Insert: {
          accident_date?: string | null
          accident_state?: string | null
          airbag_deployment?: string | null
          at_fault_insurer?: string | null
          availability?: string | null
          case_id: string
          created_at?: string
          current_mileage?: number | null
          draft_step?: string
          email?: string | null
          full_name?: string | null
          major_repair_details?: string | null
          mileage_at_accident?: number | null
          notes?: string | null
          other_party_at_fault?: string | null
          phone?: string | null
          preferred_contact_method?: string | null
          repair_cost?: number | null
          repair_facility?: string | null
          repair_status?: string | null
          revision?: number
          structural_damage?: string | null
          submitted_at?: string | null
          updated_at?: string
          vehicle_configuration?: Json | null
          vehicle_entry_method?: string
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_trim?: string | null
          vehicle_year?: number | null
          vin?: string | null
        }
        Update: {
          accident_date?: string | null
          accident_state?: string | null
          airbag_deployment?: string | null
          at_fault_insurer?: string | null
          availability?: string | null
          case_id?: string
          created_at?: string
          current_mileage?: number | null
          draft_step?: string
          email?: string | null
          full_name?: string | null
          major_repair_details?: string | null
          mileage_at_accident?: number | null
          notes?: string | null
          other_party_at_fault?: string | null
          phone?: string | null
          preferred_contact_method?: string | null
          repair_cost?: number | null
          repair_facility?: string | null
          repair_status?: string | null
          revision?: number
          structural_damage?: string | null
          submitted_at?: string | null
          updated_at?: string
          vehicle_configuration?: Json | null
          vehicle_entry_method?: string
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_trim?: string | null
          vehicle_year?: number | null
          vin?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "diminished_value_case_details_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "appraisal_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "diminished_value_case_details_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "total_loss_case_operations_internal"
            referencedColumns: ["case_id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          amount_minor_units: number
          case_id: string
          checkout_attempt_id: string | null
          currency: string
          external_event_id: string | null
          external_object_id: string
          id: string
          metadata: Json
          order_id: string
          payment_provider: string
          provider_occurred_at: string
          recorded_at: string
          related_transaction_id: string | null
          transaction_kind: string
        }
        Insert: {
          amount_minor_units: number
          case_id: string
          checkout_attempt_id?: string | null
          currency: string
          external_event_id?: string | null
          external_object_id: string
          id?: string
          metadata?: Json
          order_id: string
          payment_provider: string
          provider_occurred_at: string
          recorded_at?: string
          related_transaction_id?: string | null
          transaction_kind: string
        }
        Update: {
          amount_minor_units?: number
          case_id?: string
          checkout_attempt_id?: string | null
          currency?: string
          external_event_id?: string | null
          external_object_id?: string
          id?: string
          metadata?: Json
          order_id?: string
          payment_provider?: string
          provider_occurred_at?: string
          recorded_at?: string
          related_transaction_id?: string | null
          transaction_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "appraisal_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_case_operations_internal"
            referencedColumns: ["case_id"]
          },
          {
            foreignKeyName: "payment_transactions_checkout_identity_fkey"
            columns: [
              "checkout_attempt_id",
              "case_id",
              "order_id",
              "payment_provider",
            ]
            isOneToOne: false
            referencedRelation: "checkout_attempts"
            referencedColumns: ["id", "case_id", "order_id", "payment_provider"]
          },
          {
            foreignKeyName: "payment_transactions_order_currency_fkey"
            columns: ["order_id", "case_id", "currency"]
            isOneToOne: false
            referencedRelation: "commerce_orders"
            referencedColumns: ["id", "case_id", "currency"]
          },
          {
            foreignKeyName: "payment_transactions_related_case_fkey"
            columns: [
              "related_transaction_id",
              "case_id",
              "order_id",
              "payment_provider",
              "currency",
            ]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: [
              "id",
              "case_id",
              "order_id",
              "payment_provider",
              "currency",
            ]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          full_name_confirmed_at: string | null
          id: string
          operational_follow_up_allowed: boolean | null
          operational_follow_up_updated_at: string | null
          privacy_notice_acknowledged_at: string | null
          privacy_notice_version: string | null
          service_terms_acknowledged_at: string | null
          service_terms_version: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          full_name_confirmed_at?: string | null
          id: string
          operational_follow_up_allowed?: boolean | null
          operational_follow_up_updated_at?: string | null
          privacy_notice_acknowledged_at?: string | null
          privacy_notice_version?: string | null
          service_terms_acknowledged_at?: string | null
          service_terms_version?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          full_name_confirmed_at?: string | null
          id?: string
          operational_follow_up_allowed?: boolean | null
          operational_follow_up_updated_at?: string | null
          privacy_notice_acknowledged_at?: string | null
          privacy_notice_version?: string | null
          service_terms_acknowledged_at?: string | null
          service_terms_version?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      staff_members: {
        Row: {
          granted_at: string
          user_id: string
        }
        Insert: {
          granted_at?: string
          user_id: string
        }
        Update: {
          granted_at?: string
          user_id?: string
        }
        Relationships: []
      }
      total_loss_ai_review_runs: {
        Row: {
          case_id: string
          completed_at: string | null
          confidence: string | null
          created_at: string
          failure_code: string | null
          final_assessment_id: string
          id: string
          input_digest: string
          model_identifier: string
          output_digest: string | null
          prompt_version: string
          provider_identifier: string
          recommendation: string | null
          report_version_id: string | null
          review_result: Json | null
          schema_version: string
          started_at: string | null
          status: string
          updated_at: string
          usage_metadata: Json | null
        }
        Insert: {
          case_id: string
          completed_at?: string | null
          confidence?: string | null
          created_at?: string
          failure_code?: string | null
          final_assessment_id: string
          id?: string
          input_digest: string
          model_identifier: string
          output_digest?: string | null
          prompt_version: string
          provider_identifier: string
          recommendation?: string | null
          report_version_id?: string | null
          review_result?: Json | null
          schema_version: string
          started_at?: string | null
          status?: string
          updated_at?: string
          usage_metadata?: Json | null
        }
        Update: {
          case_id?: string
          completed_at?: string | null
          confidence?: string | null
          created_at?: string
          failure_code?: string | null
          final_assessment_id?: string
          id?: string
          input_digest?: string
          model_identifier?: string
          output_digest?: string | null
          prompt_version?: string
          provider_identifier?: string
          recommendation?: string | null
          report_version_id?: string | null
          review_result?: Json | null
          schema_version?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          usage_metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "total_loss_ai_review_runs_assessment_case_fkey"
            columns: ["final_assessment_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_final_assessments"
            referencedColumns: ["id", "case_id"]
          },
          {
            foreignKeyName: "total_loss_ai_review_runs_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "appraisal_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "total_loss_ai_review_runs_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_case_operations_internal"
            referencedColumns: ["case_id"]
          },
          {
            foreignKeyName: "total_loss_ai_review_runs_report_assessment_fkey"
            columns: ["report_version_id", "case_id", "final_assessment_id"]
            isOneToOne: false
            referencedRelation: "total_loss_report_versions"
            referencedColumns: ["id", "case_id", "final_assessment_id"]
          },
        ]
      }
      total_loss_analysis_jobs: {
        Row: {
          attempt_count: number
          case_id: string
          created_at: string
          failure_code: string | null
          finished_at: string | null
          id: string
          processing_expires_at: string | null
          processing_token: string
          retryable: boolean | null
          run_id: string
          source_analysis_input_id: string | null
          source_analysis_input_revision: number
          source_details_updated_at: string
          source_intake_mode: Database["public"]["Enums"]["total_loss_intake_mode"]
          source_report_upload_id: string | null
          status: Database["public"]["Enums"]["total_loss_analysis_status"]
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          case_id: string
          created_at?: string
          failure_code?: string | null
          finished_at?: string | null
          id?: string
          processing_expires_at?: string | null
          processing_token: string
          retryable?: boolean | null
          run_id?: string
          source_analysis_input_id?: string | null
          source_analysis_input_revision?: number
          source_details_updated_at: string
          source_intake_mode?: Database["public"]["Enums"]["total_loss_intake_mode"]
          source_report_upload_id?: string | null
          status?: Database["public"]["Enums"]["total_loss_analysis_status"]
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          case_id?: string
          created_at?: string
          failure_code?: string | null
          finished_at?: string | null
          id?: string
          processing_expires_at?: string | null
          processing_token?: string
          retryable?: boolean | null
          run_id?: string
          source_analysis_input_id?: string | null
          source_analysis_input_revision?: number
          source_details_updated_at?: string
          source_intake_mode?: Database["public"]["Enums"]["total_loss_intake_mode"]
          source_report_upload_id?: string | null
          status?: Database["public"]["Enums"]["total_loss_analysis_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "total_loss_analysis_jobs_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "appraisal_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "total_loss_analysis_jobs_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_case_operations_internal"
            referencedColumns: ["case_id"]
          },
        ]
      }
      total_loss_case_contacts: {
        Row: {
          case_id: string
          created_at: string
          email: string
          email_verified_at: string | null
          first_name: string | null
          full_name: string
          last_name: string | null
          operational_follow_up_allowed: boolean
          operational_follow_up_updated_at: string
          phone_number: string | null
          privacy_notice_acknowledged_at: string
          privacy_notice_version: string
          service_terms_acknowledged_at: string
          service_terms_version: string
          updated_at: string
        }
        Insert: {
          case_id: string
          created_at?: string
          email: string
          email_verified_at?: string | null
          first_name?: string | null
          full_name: string
          last_name?: string | null
          operational_follow_up_allowed: boolean
          operational_follow_up_updated_at: string
          phone_number?: string | null
          privacy_notice_acknowledged_at: string
          privacy_notice_version: string
          service_terms_acknowledged_at: string
          service_terms_version: string
          updated_at?: string
        }
        Update: {
          case_id?: string
          created_at?: string
          email?: string
          email_verified_at?: string | null
          first_name?: string | null
          full_name?: string
          last_name?: string | null
          operational_follow_up_allowed?: boolean
          operational_follow_up_updated_at?: string
          phone_number?: string | null
          privacy_notice_acknowledged_at?: string
          privacy_notice_version?: string
          service_terms_acknowledged_at?: string
          service_terms_version?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "total_loss_case_contacts_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "appraisal_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "total_loss_case_contacts_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "total_loss_case_operations_internal"
            referencedColumns: ["case_id"]
          },
        ]
      }
      total_loss_case_details: {
        Row: {
          analysis_input_id: string
          analysis_input_revision: number
          case_id: string
          created_at: string
          date_of_loss: string | null
          existing_damage_description: string | null
          insurer_name: string | null
          insurer_vehicle_valuation: number | null
          intake_completed_at: string | null
          intake_mode: Database["public"]["Enums"]["total_loss_intake_mode"]
          mileage_at_loss: number | null
          postal_code: string | null
          prior_title_status: string | null
          report_extracted_at: string | null
          report_extraction_confidence: number | null
          report_extraction_input_revision: number | null
          report_extraction_source_upload_id: string | null
          report_extraction_status: string
          report_facts_confirmed_at: string | null
          report_last_cancelled_upload_id: string | null
          report_last_upload_id: string | null
          report_original_filename: string | null
          report_provider_name: string | null
          report_storage_owner_id: string
          report_upload_details_updated_at: string | null
          report_upload_expires_at: string | null
          report_upload_has_backup: boolean
          report_upload_id: string | null
          report_upload_phase: string | null
          report_upload_recovery_required: boolean
          report_uploaded_at: string | null
          updated_at: string
          vehicle_condition: string | null
          vehicle_configuration: Json | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_options_packages: string | null
          vehicle_trim: string | null
          vehicle_year: number | null
          vin: string | null
        }
        Insert: {
          analysis_input_id?: string
          analysis_input_revision?: number
          case_id: string
          created_at?: string
          date_of_loss?: string | null
          existing_damage_description?: string | null
          insurer_name?: string | null
          insurer_vehicle_valuation?: number | null
          intake_completed_at?: string | null
          intake_mode: Database["public"]["Enums"]["total_loss_intake_mode"]
          mileage_at_loss?: number | null
          postal_code?: string | null
          prior_title_status?: string | null
          report_extracted_at?: string | null
          report_extraction_confidence?: number | null
          report_extraction_input_revision?: number | null
          report_extraction_source_upload_id?: string | null
          report_extraction_status?: string
          report_facts_confirmed_at?: string | null
          report_last_cancelled_upload_id?: string | null
          report_last_upload_id?: string | null
          report_original_filename?: string | null
          report_provider_name?: string | null
          report_storage_owner_id: string
          report_upload_details_updated_at?: string | null
          report_upload_expires_at?: string | null
          report_upload_has_backup?: boolean
          report_upload_id?: string | null
          report_upload_phase?: string | null
          report_upload_recovery_required?: boolean
          report_uploaded_at?: string | null
          updated_at?: string
          vehicle_condition?: string | null
          vehicle_configuration?: Json | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_options_packages?: string | null
          vehicle_trim?: string | null
          vehicle_year?: number | null
          vin?: string | null
        }
        Update: {
          analysis_input_id?: string
          analysis_input_revision?: number
          case_id?: string
          created_at?: string
          date_of_loss?: string | null
          existing_damage_description?: string | null
          insurer_name?: string | null
          insurer_vehicle_valuation?: number | null
          intake_completed_at?: string | null
          intake_mode?: Database["public"]["Enums"]["total_loss_intake_mode"]
          mileage_at_loss?: number | null
          postal_code?: string | null
          prior_title_status?: string | null
          report_extracted_at?: string | null
          report_extraction_confidence?: number | null
          report_extraction_input_revision?: number | null
          report_extraction_source_upload_id?: string | null
          report_extraction_status?: string
          report_facts_confirmed_at?: string | null
          report_last_cancelled_upload_id?: string | null
          report_last_upload_id?: string | null
          report_original_filename?: string | null
          report_provider_name?: string | null
          report_storage_owner_id?: string
          report_upload_details_updated_at?: string | null
          report_upload_expires_at?: string | null
          report_upload_has_backup?: boolean
          report_upload_id?: string | null
          report_upload_phase?: string | null
          report_upload_recovery_required?: boolean
          report_uploaded_at?: string | null
          updated_at?: string
          vehicle_condition?: string | null
          vehicle_configuration?: Json | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_options_packages?: string | null
          vehicle_trim?: string | null
          vehicle_year?: number | null
          vin?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "total_loss_case_details_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "appraisal_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "total_loss_case_details_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "total_loss_case_operations_internal"
            referencedColumns: ["case_id"]
          },
        ]
      }
      total_loss_case_identity_claims: {
        Row: {
          case_id: string
          claimed_at: string | null
          claimed_by_user_id: string | null
          created_at: string
          expires_at: string
          id: string
          requested_email: string
          revoked_at: string | null
          source_user_id: string
        }
        Insert: {
          case_id: string
          claimed_at?: string | null
          claimed_by_user_id?: string | null
          created_at?: string
          expires_at: string
          id?: string
          requested_email: string
          revoked_at?: string | null
          source_user_id: string
        }
        Update: {
          case_id?: string
          claimed_at?: string | null
          claimed_by_user_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          requested_email?: string
          revoked_at?: string | null
          source_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "total_loss_case_identity_claims_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "appraisal_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "total_loss_case_identity_claims_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_case_operations_internal"
            referencedColumns: ["case_id"]
          },
        ]
      }
      total_loss_claim_documents: {
        Row: {
          byte_size: number | null
          case_id: string
          content_digest: string | null
          created_at: string
          created_by_user_id: string | null
          document_kind: string
          failure_code: string | null
          id: string
          media_type: string | null
          original_filename: string | null
          sealed_at: string | null
          status: string
          storage_bucket_id: string | null
          storage_object_name: string | null
          updated_at: string
        }
        Insert: {
          byte_size?: number | null
          case_id: string
          content_digest?: string | null
          created_at?: string
          created_by_user_id?: string | null
          document_kind: string
          failure_code?: string | null
          id?: string
          media_type?: string | null
          original_filename?: string | null
          sealed_at?: string | null
          status?: string
          storage_bucket_id?: string | null
          storage_object_name?: string | null
          updated_at?: string
        }
        Update: {
          byte_size?: number | null
          case_id?: string
          content_digest?: string | null
          created_at?: string
          created_by_user_id?: string | null
          document_kind?: string
          failure_code?: string | null
          id?: string
          media_type?: string | null
          original_filename?: string | null
          sealed_at?: string | null
          status?: string
          storage_bucket_id?: string | null
          storage_object_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "total_loss_claim_documents_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "appraisal_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "total_loss_claim_documents_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_case_operations_internal"
            referencedColumns: ["case_id"]
          },
        ]
      }
      total_loss_claim_workflows: {
        Row: {
          case_id: string
          created_at: string
          current_negotiation_round_id: string | null
          current_offer_id: string | null
          current_package_job_id: string | null
          current_recommendation_id: string | null
          current_report_version_id: string | null
          current_task: string
          phase: Database["public"]["Enums"]["total_loss_claim_phase"]
          preliminary_snapshot_id: string
          resolution_code: string | null
          resolved_at: string | null
          revision: number
          updated_at: string
        }
        Insert: {
          case_id: string
          created_at?: string
          current_negotiation_round_id?: string | null
          current_offer_id?: string | null
          current_package_job_id?: string | null
          current_recommendation_id?: string | null
          current_report_version_id?: string | null
          current_task: string
          phase?: Database["public"]["Enums"]["total_loss_claim_phase"]
          preliminary_snapshot_id: string
          resolution_code?: string | null
          resolved_at?: string | null
          revision?: number
          updated_at?: string
        }
        Update: {
          case_id?: string
          created_at?: string
          current_negotiation_round_id?: string | null
          current_offer_id?: string | null
          current_package_job_id?: string | null
          current_recommendation_id?: string | null
          current_report_version_id?: string | null
          current_task?: string
          phase?: Database["public"]["Enums"]["total_loss_claim_phase"]
          preliminary_snapshot_id?: string
          resolution_code?: string | null
          resolved_at?: string | null
          revision?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "total_loss_claim_workflows_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "appraisal_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "total_loss_claim_workflows_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "total_loss_case_operations_internal"
            referencedColumns: ["case_id"]
          },
          {
            foreignKeyName: "total_loss_claim_workflows_current_offer_fkey"
            columns: ["current_offer_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_offers"
            referencedColumns: ["id", "case_id"]
          },
          {
            foreignKeyName: "total_loss_claim_workflows_current_package_fkey"
            columns: ["current_package_job_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_package_jobs"
            referencedColumns: ["id", "case_id"]
          },
          {
            foreignKeyName: "total_loss_claim_workflows_current_recommendation_fkey"
            columns: ["current_recommendation_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_recommendations"
            referencedColumns: ["id", "case_id"]
          },
          {
            foreignKeyName: "total_loss_claim_workflows_current_report_fkey"
            columns: ["current_report_version_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_report_versions"
            referencedColumns: ["id", "case_id"]
          },
          {
            foreignKeyName: "total_loss_claim_workflows_current_round_fkey"
            columns: ["current_negotiation_round_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_negotiation_rounds"
            referencedColumns: ["id", "case_id"]
          },
          {
            foreignKeyName: "total_loss_claim_workflows_snapshot_case_fkey"
            columns: ["preliminary_snapshot_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_preliminary_snapshots"
            referencedColumns: ["id", "case_id"]
          },
        ]
      }
      total_loss_communication_documents: {
        Row: {
          case_id: string
          communication_id: string
          created_at: string
          display_order: number
          document_id: string
        }
        Insert: {
          case_id: string
          communication_id: string
          created_at?: string
          display_order?: number
          document_id: string
        }
        Update: {
          case_id?: string
          communication_id?: string
          created_at?: string
          display_order?: number
          document_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "total_loss_communication_documents_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "appraisal_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "total_loss_communication_documents_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_case_operations_internal"
            referencedColumns: ["case_id"]
          },
          {
            foreignKeyName: "total_loss_communication_documents_communication_case_fkey"
            columns: ["communication_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_communications"
            referencedColumns: ["id", "case_id"]
          },
          {
            foreignKeyName: "total_loss_communication_documents_document_case_fkey"
            columns: ["document_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_claim_documents"
            referencedColumns: ["id", "case_id"]
          },
        ]
      }
      total_loss_communications: {
        Row: {
          case_id: string
          channel: Database["public"]["Enums"]["total_loss_communication_channel"]
          communication_type: string
          confirmed_at: string | null
          created_at: string
          direction: Database["public"]["Enums"]["total_loss_communication_direction"]
          id: string
          message_version_id: string | null
          negotiation_round_id: string | null
          occurred_at: string | null
          original_content: string | null
          recipient: string | null
          recorded_by_user_id: string | null
          sender: string | null
          status: string
          subject: string | null
          supersedes_communication_id: string | null
          updated_at: string
        }
        Insert: {
          case_id: string
          channel: Database["public"]["Enums"]["total_loss_communication_channel"]
          communication_type: string
          confirmed_at?: string | null
          created_at?: string
          direction: Database["public"]["Enums"]["total_loss_communication_direction"]
          id?: string
          message_version_id?: string | null
          negotiation_round_id?: string | null
          occurred_at?: string | null
          original_content?: string | null
          recipient?: string | null
          recorded_by_user_id?: string | null
          sender?: string | null
          status?: string
          subject?: string | null
          supersedes_communication_id?: string | null
          updated_at?: string
        }
        Update: {
          case_id?: string
          channel?: Database["public"]["Enums"]["total_loss_communication_channel"]
          communication_type?: string
          confirmed_at?: string | null
          created_at?: string
          direction?: Database["public"]["Enums"]["total_loss_communication_direction"]
          id?: string
          message_version_id?: string | null
          negotiation_round_id?: string | null
          occurred_at?: string | null
          original_content?: string | null
          recipient?: string | null
          recorded_by_user_id?: string | null
          sender?: string | null
          status?: string
          subject?: string | null
          supersedes_communication_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "total_loss_communications_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_claim_workflows"
            referencedColumns: ["case_id"]
          },
          {
            foreignKeyName: "total_loss_communications_message_case_fkey"
            columns: ["message_version_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_message_versions"
            referencedColumns: ["id", "case_id"]
          },
          {
            foreignKeyName: "total_loss_communications_round_case_fkey"
            columns: ["negotiation_round_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_negotiation_rounds"
            referencedColumns: ["id", "case_id"]
          },
          {
            foreignKeyName: "total_loss_communications_supersedes_case_fkey"
            columns: ["supersedes_communication_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_communications"
            referencedColumns: ["id", "case_id"]
          },
        ]
      }
      total_loss_education_progress: {
        Row: {
          case_id: string
          completed_at: string | null
          created_at: string
          report_version_id: string
          skipped_at: string | null
          step_identifier: string
          updated_at: string
          viewed_at: string | null
        }
        Insert: {
          case_id: string
          completed_at?: string | null
          created_at?: string
          report_version_id: string
          skipped_at?: string | null
          step_identifier: string
          updated_at?: string
          viewed_at?: string | null
        }
        Update: {
          case_id?: string
          completed_at?: string | null
          created_at?: string
          report_version_id?: string
          skipped_at?: string | null
          step_identifier?: string
          updated_at?: string
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "total_loss_education_progress_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "appraisal_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "total_loss_education_progress_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_case_operations_internal"
            referencedColumns: ["case_id"]
          },
          {
            foreignKeyName: "total_loss_education_progress_report_case_fkey"
            columns: ["report_version_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_report_versions"
            referencedColumns: ["id", "case_id"]
          },
        ]
      }
      total_loss_fact_assertions: {
        Row: {
          case_id: string
          confidence: number | null
          confirmed_at: string | null
          confirmed_by_user_id: string | null
          created_at: string
          extraction_method: string
          fact_type: string
          fact_value: Json
          id: string
          source_assessment_id: string | null
          source_communication_id: string | null
          source_document_id: string | null
          source_locator: Json
          status: string
          supersedes_fact_assertion_id: string | null
          updated_at: string
        }
        Insert: {
          case_id: string
          confidence?: number | null
          confirmed_at?: string | null
          confirmed_by_user_id?: string | null
          created_at?: string
          extraction_method: string
          fact_type: string
          fact_value: Json
          id?: string
          source_assessment_id?: string | null
          source_communication_id?: string | null
          source_document_id?: string | null
          source_locator?: Json
          status?: string
          supersedes_fact_assertion_id?: string | null
          updated_at?: string
        }
        Update: {
          case_id?: string
          confidence?: number | null
          confirmed_at?: string | null
          confirmed_by_user_id?: string | null
          created_at?: string
          extraction_method?: string
          fact_type?: string
          fact_value?: Json
          id?: string
          source_assessment_id?: string | null
          source_communication_id?: string | null
          source_document_id?: string | null
          source_locator?: Json
          status?: string
          supersedes_fact_assertion_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "total_loss_fact_assertions_assessment_case_fkey"
            columns: ["source_assessment_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_final_assessments"
            referencedColumns: ["id", "case_id"]
          },
          {
            foreignKeyName: "total_loss_fact_assertions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "appraisal_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "total_loss_fact_assertions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_case_operations_internal"
            referencedColumns: ["case_id"]
          },
          {
            foreignKeyName: "total_loss_fact_assertions_communication_case_fkey"
            columns: ["source_communication_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_communications"
            referencedColumns: ["id", "case_id"]
          },
          {
            foreignKeyName: "total_loss_fact_assertions_document_case_fkey"
            columns: ["source_document_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_claim_documents"
            referencedColumns: ["id", "case_id"]
          },
          {
            foreignKeyName: "total_loss_fact_assertions_supersedes_fkey"
            columns: ["supersedes_fact_assertion_id", "case_id", "fact_type"]
            isOneToOne: false
            referencedRelation: "total_loss_fact_assertions"
            referencedColumns: ["id", "case_id", "fact_type"]
          },
        ]
      }
      total_loss_final_assessments: {
        Row: {
          assessment: Json
          assessment_digest: string
          case_id: string
          conclusion_code: string
          created_at: string
          currency: string
          findings: Json
          id: string
          limitations: Json
          methodology_version: string
          package_job_id: string
          preliminary_snapshot_id: string
          preliminary_to_final_comparison: Json
          reason_codes: Json
          schema_version: string
          supersedes_assessment_id: string | null
          supported_range_high_minor_units: number | null
          supported_range_low_minor_units: number | null
          supported_range_median_minor_units: number | null
          version_number: number
        }
        Insert: {
          assessment: Json
          assessment_digest: string
          case_id: string
          conclusion_code: string
          created_at?: string
          currency: string
          findings: Json
          id?: string
          limitations: Json
          methodology_version: string
          package_job_id: string
          preliminary_snapshot_id: string
          preliminary_to_final_comparison: Json
          reason_codes: Json
          schema_version: string
          supersedes_assessment_id?: string | null
          supported_range_high_minor_units?: number | null
          supported_range_low_minor_units?: number | null
          supported_range_median_minor_units?: number | null
          version_number: number
        }
        Update: {
          assessment?: Json
          assessment_digest?: string
          case_id?: string
          conclusion_code?: string
          created_at?: string
          currency?: string
          findings?: Json
          id?: string
          limitations?: Json
          methodology_version?: string
          package_job_id?: string
          preliminary_snapshot_id?: string
          preliminary_to_final_comparison?: Json
          reason_codes?: Json
          schema_version?: string
          supersedes_assessment_id?: string | null
          supported_range_high_minor_units?: number | null
          supported_range_low_minor_units?: number | null
          supported_range_median_minor_units?: number | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "total_loss_final_assessments_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "appraisal_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "total_loss_final_assessments_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_case_operations_internal"
            referencedColumns: ["case_id"]
          },
          {
            foreignKeyName: "total_loss_final_assessments_job_identity_fkey"
            columns: ["package_job_id", "case_id", "preliminary_snapshot_id"]
            isOneToOne: false
            referencedRelation: "total_loss_package_jobs"
            referencedColumns: ["id", "case_id", "preliminary_snapshot_id"]
          },
          {
            foreignKeyName: "total_loss_final_assessments_snapshot_case_fkey"
            columns: ["preliminary_snapshot_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_preliminary_snapshots"
            referencedColumns: ["id", "case_id"]
          },
          {
            foreignKeyName: "total_loss_final_assessments_supersedes_fkey"
            columns: [
              "supersedes_assessment_id",
              "case_id",
              "preliminary_snapshot_id",
            ]
            isOneToOne: false
            referencedRelation: "total_loss_final_assessments"
            referencedColumns: ["id", "case_id", "preliminary_snapshot_id"]
          },
        ]
      }
      total_loss_message_drafts: {
        Row: {
          body: string
          case_id: string
          created_at: string
          id: string
          negotiation_round_id: string | null
          purpose: string
          recipient: string | null
          report_version_id: string | null
          revision: number
          subject: string
          updated_at: string
        }
        Insert: {
          body?: string
          case_id: string
          created_at?: string
          id?: string
          negotiation_round_id?: string | null
          purpose: string
          recipient?: string | null
          report_version_id?: string | null
          revision?: number
          subject?: string
          updated_at?: string
        }
        Update: {
          body?: string
          case_id?: string
          created_at?: string
          id?: string
          negotiation_round_id?: string | null
          purpose?: string
          recipient?: string | null
          report_version_id?: string | null
          revision?: number
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "total_loss_message_drafts_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_claim_workflows"
            referencedColumns: ["case_id"]
          },
          {
            foreignKeyName: "total_loss_message_drafts_report_case_fkey"
            columns: ["report_version_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_report_versions"
            referencedColumns: ["id", "case_id"]
          },
          {
            foreignKeyName: "total_loss_message_drafts_round_case_fkey"
            columns: ["negotiation_round_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_negotiation_rounds"
            referencedColumns: ["id", "case_id"]
          },
        ]
      }
      total_loss_message_versions: {
        Row: {
          body: string
          case_id: string
          created_at: string
          id: string
          message_digest: string
          message_draft_id: string
          message_state: string
          negotiation_round_id: string | null
          purpose: string
          recipient: string
          report_version_id: string | null
          sent_at: string | null
          subject: string
          supersedes_message_version_id: string | null
          version_number: number
        }
        Insert: {
          body: string
          case_id: string
          created_at?: string
          id?: string
          message_digest: string
          message_draft_id: string
          message_state: string
          negotiation_round_id?: string | null
          purpose: string
          recipient: string
          report_version_id?: string | null
          sent_at?: string | null
          subject: string
          supersedes_message_version_id?: string | null
          version_number: number
        }
        Update: {
          body?: string
          case_id?: string
          created_at?: string
          id?: string
          message_digest?: string
          message_draft_id?: string
          message_state?: string
          negotiation_round_id?: string | null
          purpose?: string
          recipient?: string
          report_version_id?: string | null
          sent_at?: string | null
          subject?: string
          supersedes_message_version_id?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "total_loss_message_versions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "appraisal_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "total_loss_message_versions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_case_operations_internal"
            referencedColumns: ["case_id"]
          },
          {
            foreignKeyName: "total_loss_message_versions_draft_case_fkey"
            columns: ["message_draft_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_message_drafts"
            referencedColumns: ["id", "case_id"]
          },
          {
            foreignKeyName: "total_loss_message_versions_report_case_fkey"
            columns: ["report_version_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_report_versions"
            referencedColumns: ["id", "case_id"]
          },
          {
            foreignKeyName: "total_loss_message_versions_round_case_fkey"
            columns: ["negotiation_round_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_negotiation_rounds"
            referencedColumns: ["id", "case_id"]
          },
          {
            foreignKeyName: "total_loss_message_versions_supersedes_fkey"
            columns: [
              "supersedes_message_version_id",
              "case_id",
              "message_draft_id",
            ]
            isOneToOne: false
            referencedRelation: "total_loss_message_versions"
            referencedColumns: ["id", "case_id", "message_draft_id"]
          },
        ]
      }
      total_loss_negotiation_rounds: {
        Row: {
          case_id: string
          closed_at: string | null
          created_at: string
          id: string
          opened_at: string
          originating_communication_id: string | null
          revision: number
          round_number: number
          status: string
          updated_at: string
        }
        Insert: {
          case_id: string
          closed_at?: string | null
          created_at?: string
          id?: string
          opened_at?: string
          originating_communication_id?: string | null
          revision?: number
          round_number: number
          status?: string
          updated_at?: string
        }
        Update: {
          case_id?: string
          closed_at?: string | null
          created_at?: string
          id?: string
          opened_at?: string
          originating_communication_id?: string | null
          revision?: number
          round_number?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "total_loss_negotiation_rounds_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_claim_workflows"
            referencedColumns: ["case_id"]
          },
          {
            foreignKeyName: "total_loss_negotiation_rounds_origin_case_fkey"
            columns: ["originating_communication_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_communications"
            referencedColumns: ["id", "case_id"]
          },
        ]
      }
      total_loss_offers: {
        Row: {
          amount_minor_units: number
          case_id: string
          created_at: string
          currency: string
          decided_at: string | null
          decision_recorded_by_user_id: string | null
          id: string
          negotiation_round_id: string
          offer_kind: string
          received_at: string
          source_communication_id: string
          source_fact_assertion_id: string | null
          status: string
          supersedes_offer_id: string | null
          updated_at: string
        }
        Insert: {
          amount_minor_units: number
          case_id: string
          created_at?: string
          currency: string
          decided_at?: string | null
          decision_recorded_by_user_id?: string | null
          id?: string
          negotiation_round_id: string
          offer_kind: string
          received_at: string
          source_communication_id: string
          source_fact_assertion_id?: string | null
          status?: string
          supersedes_offer_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_minor_units?: number
          case_id?: string
          created_at?: string
          currency?: string
          decided_at?: string | null
          decision_recorded_by_user_id?: string | null
          id?: string
          negotiation_round_id?: string
          offer_kind?: string
          received_at?: string
          source_communication_id?: string
          source_fact_assertion_id?: string | null
          status?: string
          supersedes_offer_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "total_loss_offers_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "appraisal_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "total_loss_offers_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_case_operations_internal"
            referencedColumns: ["case_id"]
          },
          {
            foreignKeyName: "total_loss_offers_communication_case_fkey"
            columns: ["source_communication_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_communications"
            referencedColumns: ["id", "case_id"]
          },
          {
            foreignKeyName: "total_loss_offers_fact_case_fkey"
            columns: ["source_fact_assertion_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_fact_assertions"
            referencedColumns: ["id", "case_id"]
          },
          {
            foreignKeyName: "total_loss_offers_round_case_fkey"
            columns: ["negotiation_round_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_negotiation_rounds"
            referencedColumns: ["id", "case_id"]
          },
          {
            foreignKeyName: "total_loss_offers_supersedes_case_fkey"
            columns: ["supersedes_offer_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_offers"
            referencedColumns: ["id", "case_id"]
          },
        ]
      }
      total_loss_package_jobs: {
        Row: {
          attempt_count: number
          case_id: string
          created_at: string
          entitlement_id: string
          failure_code: string | null
          finished_at: string | null
          id: string
          preliminary_snapshot_id: string
          processing_expires_at: string | null
          processing_token: string | null
          retryable: boolean | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          case_id: string
          created_at?: string
          entitlement_id: string
          failure_code?: string | null
          finished_at?: string | null
          id?: string
          preliminary_snapshot_id: string
          processing_expires_at?: string | null
          processing_token?: string | null
          retryable?: boolean | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          case_id?: string
          created_at?: string
          entitlement_id?: string
          failure_code?: string | null
          finished_at?: string | null
          id?: string
          preliminary_snapshot_id?: string
          processing_expires_at?: string | null
          processing_token?: string | null
          retryable?: boolean | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "total_loss_package_jobs_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "appraisal_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "total_loss_package_jobs_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_case_operations_internal"
            referencedColumns: ["case_id"]
          },
          {
            foreignKeyName: "total_loss_package_jobs_entitlement_identity_fkey"
            columns: ["entitlement_id", "case_id", "preliminary_snapshot_id"]
            isOneToOne: false
            referencedRelation: "case_entitlements"
            referencedColumns: ["id", "case_id", "preliminary_snapshot_id"]
          },
          {
            foreignKeyName: "total_loss_package_jobs_snapshot_case_fkey"
            columns: ["preliminary_snapshot_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_preliminary_snapshots"
            referencedColumns: ["id", "case_id"]
          },
        ]
      }
      total_loss_preliminary_snapshots: {
        Row: {
          analysis_job_id: string
          analysis_run_id: string
          analysis_run_schema_version: string
          analysis_version: string
          case_id: string
          comparable_scoring_version: string
          created_at: string
          currency: string
          discrepancy_analysis_version: string
          id: string
          insurer_valuation_minor_units: number | null
          owner_user_id_at_snapshot: string
          preliminary_classification: string
          presentation_schema_version: string
          snapshot: Json
          snapshot_digest: string
          snapshot_schema_version: string
          source_analysis_input_id: string | null
          source_analysis_input_revision: number
          source_intake_mode: Database["public"]["Enums"]["total_loss_intake_mode"]
          source_references: Json
          source_report_upload_id: string | null
          supported_range_high_minor_units: number | null
          supported_range_low_minor_units: number | null
          supported_range_median_minor_units: number | null
        }
        Insert: {
          analysis_job_id: string
          analysis_run_id: string
          analysis_run_schema_version: string
          analysis_version: string
          case_id: string
          comparable_scoring_version: string
          created_at?: string
          currency: string
          discrepancy_analysis_version: string
          id?: string
          insurer_valuation_minor_units?: number | null
          owner_user_id_at_snapshot: string
          preliminary_classification: string
          presentation_schema_version: string
          snapshot: Json
          snapshot_digest: string
          snapshot_schema_version: string
          source_analysis_input_id?: string | null
          source_analysis_input_revision: number
          source_intake_mode: Database["public"]["Enums"]["total_loss_intake_mode"]
          source_references: Json
          source_report_upload_id?: string | null
          supported_range_high_minor_units?: number | null
          supported_range_low_minor_units?: number | null
          supported_range_median_minor_units?: number | null
        }
        Update: {
          analysis_job_id?: string
          analysis_run_id?: string
          analysis_run_schema_version?: string
          analysis_version?: string
          case_id?: string
          comparable_scoring_version?: string
          created_at?: string
          currency?: string
          discrepancy_analysis_version?: string
          id?: string
          insurer_valuation_minor_units?: number | null
          owner_user_id_at_snapshot?: string
          preliminary_classification?: string
          presentation_schema_version?: string
          snapshot?: Json
          snapshot_digest?: string
          snapshot_schema_version?: string
          source_analysis_input_id?: string | null
          source_analysis_input_revision?: number
          source_intake_mode?: Database["public"]["Enums"]["total_loss_intake_mode"]
          source_references?: Json
          source_report_upload_id?: string | null
          supported_range_high_minor_units?: number | null
          supported_range_low_minor_units?: number | null
          supported_range_median_minor_units?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "total_loss_preliminary_snapshots_analysis_run_id_fkey"
            columns: ["analysis_run_id"]
            isOneToOne: false
            referencedRelation: "analysis_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "total_loss_preliminary_snapshots_analysis_run_id_fkey"
            columns: ["analysis_run_id"]
            isOneToOne: false
            referencedRelation: "total_loss_case_operations_internal"
            referencedColumns: ["analysis_run_id"]
          },
          {
            foreignKeyName: "total_loss_preliminary_snapshots_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "appraisal_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "total_loss_preliminary_snapshots_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_case_operations_internal"
            referencedColumns: ["case_id"]
          },
          {
            foreignKeyName: "total_loss_preliminary_snapshots_run_identity_fkey"
            columns: ["analysis_run_id", "analysis_job_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_analysis_jobs"
            referencedColumns: ["run_id", "id", "case_id"]
          },
        ]
      }
      total_loss_recommendations: {
        Row: {
          case_id: string
          created_at: string
          created_by_user_id: string | null
          evidence_references: Json
          generation_method: string
          id: string
          model_identifier: string | null
          negotiation_round_id: string
          provider_identifier: string | null
          published_at: string | null
          recommendation: Json
          recommendation_digest: string
          recommendation_type: string
          status: string
          supersedes_recommendation_id: string | null
          updated_at: string
          version_number: number
        }
        Insert: {
          case_id: string
          created_at?: string
          created_by_user_id?: string | null
          evidence_references: Json
          generation_method: string
          id?: string
          model_identifier?: string | null
          negotiation_round_id: string
          provider_identifier?: string | null
          published_at?: string | null
          recommendation: Json
          recommendation_digest: string
          recommendation_type: string
          status?: string
          supersedes_recommendation_id?: string | null
          updated_at?: string
          version_number: number
        }
        Update: {
          case_id?: string
          created_at?: string
          created_by_user_id?: string | null
          evidence_references?: Json
          generation_method?: string
          id?: string
          model_identifier?: string | null
          negotiation_round_id?: string
          provider_identifier?: string | null
          published_at?: string | null
          recommendation?: Json
          recommendation_digest?: string
          recommendation_type?: string
          status?: string
          supersedes_recommendation_id?: string | null
          updated_at?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "total_loss_recommendations_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "appraisal_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "total_loss_recommendations_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_case_operations_internal"
            referencedColumns: ["case_id"]
          },
          {
            foreignKeyName: "total_loss_recommendations_round_case_fkey"
            columns: ["negotiation_round_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_negotiation_rounds"
            referencedColumns: ["id", "case_id"]
          },
          {
            foreignKeyName: "total_loss_recommendations_supersedes_fkey"
            columns: [
              "supersedes_recommendation_id",
              "case_id",
              "negotiation_round_id",
            ]
            isOneToOne: false
            referencedRelation: "total_loss_recommendations"
            referencedColumns: ["id", "case_id", "negotiation_round_id"]
          },
        ]
      }
      total_loss_release_reviews: {
        Row: {
          ai_review_run_id: string
          assigned_staff_user_id: string | null
          case_id: string
          created_at: string
          decision: string | null
          due_at: string | null
          id: string
          rationale: string | null
          resolved_at: string | null
          resolved_by_user_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          ai_review_run_id: string
          assigned_staff_user_id?: string | null
          case_id: string
          created_at?: string
          decision?: string | null
          due_at?: string | null
          id?: string
          rationale?: string | null
          resolved_at?: string | null
          resolved_by_user_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          ai_review_run_id?: string
          assigned_staff_user_id?: string | null
          case_id?: string
          created_at?: string
          decision?: string | null
          due_at?: string | null
          id?: string
          rationale?: string | null
          resolved_at?: string | null
          resolved_by_user_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "total_loss_release_reviews_ai_case_fkey"
            columns: ["ai_review_run_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_ai_review_runs"
            referencedColumns: ["id", "case_id"]
          },
          {
            foreignKeyName: "total_loss_release_reviews_assigned_staff_user_id_fkey"
            columns: ["assigned_staff_user_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "total_loss_release_reviews_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "appraisal_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "total_loss_release_reviews_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_case_operations_internal"
            referencedColumns: ["case_id"]
          },
        ]
      }
      total_loss_report_extractions: {
        Row: {
          analysis_input_id: string
          analysis_input_revision: number
          case_id: string
          confidence: number | null
          extracted_at: string
          extraction_schema_version: string
          extraction_status: string
          normalized_report: Json | null
          provider_name: string | null
          report_upload_id: string
          updated_at: string
        }
        Insert: {
          analysis_input_id: string
          analysis_input_revision: number
          case_id: string
          confidence?: number | null
          extracted_at: string
          extraction_schema_version: string
          extraction_status: string
          normalized_report?: Json | null
          provider_name?: string | null
          report_upload_id: string
          updated_at?: string
        }
        Update: {
          analysis_input_id?: string
          analysis_input_revision?: number
          case_id?: string
          confidence?: number | null
          extracted_at?: string
          extraction_schema_version?: string
          extraction_status?: string
          normalized_report?: Json | null
          provider_name?: string | null
          report_upload_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "total_loss_report_extractions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_case_details"
            referencedColumns: ["case_id"]
          },
        ]
      }
      total_loss_report_series: {
        Row: {
          case_id: string
          created_at: string
          id: string
          product_identifier: string
          report_kind: string
        }
        Insert: {
          case_id: string
          created_at?: string
          id?: string
          product_identifier: string
          report_kind: string
        }
        Update: {
          case_id?: string
          created_at?: string
          id?: string
          product_identifier?: string
          report_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "total_loss_report_series_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_claim_workflows"
            referencedColumns: ["case_id"]
          },
        ]
      }
      total_loss_report_versions: {
        Row: {
          case_id: string
          created_at: string
          document_id: string | null
          final_assessment_id: string
          id: string
          preliminary_snapshot_id: string
          published_at: string | null
          renderer_version: string
          report: Json
          report_digest: string
          report_series_id: string
          schema_version: string
          status: string
          supersedes_report_version_id: string | null
          template_version: string
          updated_at: string
          version_number: number
        }
        Insert: {
          case_id: string
          created_at?: string
          document_id?: string | null
          final_assessment_id: string
          id?: string
          preliminary_snapshot_id: string
          published_at?: string | null
          renderer_version: string
          report: Json
          report_digest: string
          report_series_id: string
          schema_version: string
          status?: string
          supersedes_report_version_id?: string | null
          template_version: string
          updated_at?: string
          version_number: number
        }
        Update: {
          case_id?: string
          created_at?: string
          document_id?: string | null
          final_assessment_id?: string
          id?: string
          preliminary_snapshot_id?: string
          published_at?: string | null
          renderer_version?: string
          report?: Json
          report_digest?: string
          report_series_id?: string
          schema_version?: string
          status?: string
          supersedes_report_version_id?: string | null
          template_version?: string
          updated_at?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "total_loss_report_versions_assessment_case_fkey"
            columns: [
              "final_assessment_id",
              "case_id",
              "preliminary_snapshot_id",
            ]
            isOneToOne: false
            referencedRelation: "total_loss_final_assessments"
            referencedColumns: ["id", "case_id", "preliminary_snapshot_id"]
          },
          {
            foreignKeyName: "total_loss_report_versions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "appraisal_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "total_loss_report_versions_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_case_operations_internal"
            referencedColumns: ["case_id"]
          },
          {
            foreignKeyName: "total_loss_report_versions_document_case_fkey"
            columns: ["document_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_claim_documents"
            referencedColumns: ["id", "case_id"]
          },
          {
            foreignKeyName: "total_loss_report_versions_series_case_fkey"
            columns: ["report_series_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_report_series"
            referencedColumns: ["id", "case_id"]
          },
          {
            foreignKeyName: "total_loss_report_versions_snapshot_case_fkey"
            columns: ["preliminary_snapshot_id", "case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_preliminary_snapshots"
            referencedColumns: ["id", "case_id"]
          },
          {
            foreignKeyName: "total_loss_report_versions_supersedes_fkey"
            columns: [
              "supersedes_report_version_id",
              "case_id",
              "report_series_id",
            ]
            isOneToOne: false
            referencedRelation: "total_loss_report_versions"
            referencedColumns: ["id", "case_id", "report_series_id"]
          },
        ]
      }
      total_loss_workflow_events: {
        Row: {
          actor_type: string
          actor_user_id: string | null
          associated_entity_id: string | null
          associated_entity_type: string | null
          case_id: string
          client_request_id: string | null
          created_at: string
          details: Json
          event_type: string
          id: string
        }
        Insert: {
          actor_type: string
          actor_user_id?: string | null
          associated_entity_id?: string | null
          associated_entity_type?: string | null
          case_id: string
          client_request_id?: string | null
          created_at?: string
          details?: Json
          event_type: string
          id?: string
        }
        Update: {
          actor_type?: string
          actor_user_id?: string | null
          associated_entity_id?: string | null
          associated_entity_type?: string | null
          case_id?: string
          client_request_id?: string | null
          created_at?: string
          details?: Json
          event_type?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "total_loss_workflow_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "total_loss_claim_workflows"
            referencedColumns: ["case_id"]
          },
        ]
      }
      vehicle_trim_cache: {
        Row: {
          created_at: string
          generation_expires_at: string | null
          generation_token: string
          lookup_key: string
          model_identifier: string | null
          status: string
          trims: Json | null
          updated_at: string
          vehicle_make: string
          vehicle_model: string
          vehicle_year: number
        }
        Insert: {
          created_at?: string
          generation_expires_at?: string | null
          generation_token: string
          lookup_key: string
          model_identifier?: string | null
          status?: string
          trims?: Json | null
          updated_at?: string
          vehicle_make: string
          vehicle_model: string
          vehicle_year: number
        }
        Update: {
          created_at?: string
          generation_expires_at?: string | null
          generation_token?: string
          lookup_key?: string
          model_identifier?: string | null
          status?: string
          trims?: Json | null
          updated_at?: string
          vehicle_make?: string
          vehicle_model?: string
          vehicle_year?: number
        }
        Relationships: []
      }
    }
    Views: {
      total_loss_case_operations_internal: {
        Row: {
          analysis_attempt_count: number | null
          analysis_classification: string | null
          analysis_evidence_basis: string | null
          analysis_evidence_strength: string | null
          analysis_failure_code: string | null
          analysis_input_id: string | null
          analysis_input_revision: number | null
          analysis_job_created_at: string | null
          analysis_job_finished_at: string | null
          analysis_job_id: string | null
          analysis_job_updated_at: string | null
          analysis_processing_expires_at: string | null
          analysis_retryable: boolean | null
          analysis_run_created_at: string | null
          analysis_run_id: string | null
          analysis_run_schema_version: string | null
          analysis_status:
            | Database["public"]["Enums"]["total_loss_analysis_status"]
            | null
          analysis_version: string | null
          canonical_report_available: boolean | null
          case_created_at: string | null
          case_id: string | null
          case_stage: Database["public"]["Enums"]["case_operation_stage"] | null
          case_status:
            | Database["public"]["Enums"]["appraisal_case_status"]
            | null
          case_updated_at: string | null
          comparable_scoring_version: string | null
          contact_email: string | null
          contact_email_verified: boolean | null
          contact_full_name: string | null
          customer_full_name: string | null
          date_of_loss: string | null
          details_created_at: string | null
          details_updated_at: string | null
          discrepancy_analysis_version: string | null
          email_verified_at: string | null
          identity_claimed_at: string | null
          insurer_name: string | null
          insurer_vehicle_valuation: number | null
          intake_completed_at: string | null
          intake_mode:
            | Database["public"]["Enums"]["total_loss_intake_mode"]
            | null
          last_activity_at: string | null
          mileage_at_loss: number | null
          operational_follow_up_allowed: boolean | null
          owner_is_anonymous: boolean | null
          owner_user_id: string | null
          postal_code: string | null
          report_extracted_at: string | null
          report_extraction_confidence: number | null
          report_extraction_status: string | null
          report_facts_confirmed_at: string | null
          report_last_upload_id: string | null
          report_original_filename: string | null
          report_provider_name: string | null
          report_storage_object_path: string | null
          report_storage_owner_id: string | null
          report_upload_expires_at: string | null
          report_upload_id: string | null
          report_uploaded_at: string | null
          service_type:
            | Database["public"]["Enums"]["appraisal_service_type"]
            | null
          vehicle_condition: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_options_packages: string | null
          vehicle_trim: string | null
          vehicle_year: number | null
          verified_email: string | null
          vin: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      acquire_total_loss_report_upload: {
        Args: {
          case_id: string
          expected_updated_at: string
          upload_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["total_loss_report_upload_lease"][]
        SetofOptions: {
          from: "*"
          to: "total_loss_report_upload_lease"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      anonymous_guest_cleanup_user_frozen: {
        Args: { candidate_user_id: string }
        Returns: boolean
      }
      assert_anonymous_guest_cleanup_user_mutable: {
        Args: { candidate_user_id: string }
        Returns: undefined
      }
      authorize_diminished_value_document_mutation: {
        Args: { object_name: string }
        Returns: boolean
      }
      authorize_staff_diminished_value_document_read: {
        Args: { object_name: string }
        Returns: boolean
      }
      authorize_total_loss_report_backup_delete: {
        Args: { object_name: string; object_user_metadata: Json }
        Returns: boolean
      }
      authorize_total_loss_report_storage_write: {
        Args: { object_name: string; object_user_metadata: Json }
        Returns: boolean
      }
      authorize_total_loss_storage_namespace: {
        Args: { object_name: string }
        Returns: boolean
      }
      begin_abandoned_anonymous_guest_cleanup_run: {
        Args: { batch_size?: number; requested_dry_run?: boolean }
        Returns: {
          cancelled_count: number
          dry_run: boolean
          eligible_count: number
          marked_count: number
          run_id: string
          run_status: string
        }[]
      }
      block_abandoned_anonymous_guest_cleanup_candidate: {
        Args: {
          candidate_lease_token: string
          candidate_user_id: string
          error_code: string
        }
        Returns: boolean
      }
      build_total_loss_analysis_input_snapshot: {
        Args: {
          details: Database["public"]["Tables"]["total_loss_case_details"]["Row"]
        }
        Returns: Json
      }
      cancel_total_loss_report_upload: {
        Args: { case_id: string; upload_id: string }
        Returns: Database["public"]["CompositeTypes"]["total_loss_case_details_public"][]
        SetofOptions: {
          from: "*"
          to: "total_loss_case_details_public"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_abandoned_anonymous_guest_cleanup_candidate: {
        Args: { cleanup_run_id: string; requested_lease_token: string }
        Returns: {
          case_ids: string[]
          cleanup_action: string
          storage_object_paths: string[]
          storage_prefixes: string[]
          user_id: string
        }[]
      }
      claim_total_loss_analysis: {
        Args: { case_id: string; processing_token: string; user_id: string }
        Returns: Database["public"]["CompositeTypes"]["total_loss_analysis_result"][]
        SetofOptions: {
          from: "*"
          to: "total_loss_analysis_result"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_vehicle_trim_cache: {
        Args: {
          requested_generation_token: string
          requested_lookup_key: string
          requested_vehicle_make: string
          requested_vehicle_model: string
          requested_vehicle_year: number
        }
        Returns: {
          model_identifier: string
          outcome: string
          trims: Json
        }[]
      }
      complete_abandoned_anonymous_guest_cleanup_candidate: {
        Args: { candidate_lease_token: string; candidate_user_id: string }
        Returns: boolean
      }
      complete_total_loss_analysis: {
        Args: {
          artifact: Json
          job_id: string
          processing_token: string
          run_id: string
        }
        Returns: boolean
      }
      complete_total_loss_case_claim: {
        Args: { claim_id: string }
        Returns: Database["public"]["CompositeTypes"]["total_loss_case_claim_result"][]
        SetofOptions: {
          from: "*"
          to: "total_loss_case_claim_result"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      complete_total_loss_report_upload_recovery: {
        Args: { case_id: string; upload_id: string }
        Returns: Database["public"]["CompositeTypes"]["total_loss_report_upload_lease"][]
        SetofOptions: {
          from: "*"
          to: "total_loss_report_upload_lease"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      complete_vehicle_trim_cache: {
        Args: {
          requested_generation_token: string
          requested_lookup_key: string
          requested_model_identifier: string
          requested_trims: Json
        }
        Returns: boolean
      }
      confirm_customer_profile: {
        Args: {
          full_name: string
          operational_follow_up_allowed: boolean
          privacy_notice_version: string
          service_terms_version: string
        }
        Returns: {
          created_at: string
          display_name: string | null
          full_name_confirmed_at: string | null
          id: string
          operational_follow_up_allowed: boolean | null
          operational_follow_up_updated_at: string | null
          privacy_notice_acknowledged_at: string | null
          privacy_notice_version: string | null
          service_terms_acknowledged_at: string | null
          service_terms_version: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confirm_total_loss_intake: {
        Args: { case_id: string; expected_details_updated_at: string }
        Returns: Database["public"]["CompositeTypes"]["total_loss_intake_confirmation_result"][]
        SetofOptions: {
          from: "*"
          to: "total_loss_intake_confirmation_result"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      current_auth_user_is_anonymous: { Args: never; Returns: boolean }
      fail_total_loss_analysis: {
        Args: {
          failure_code: string
          job_id: string
          processing_token: string
          retryable: boolean
        }
        Returns: boolean
      }
      finalize_total_loss_report_upload: {
        Args: {
          case_id: string
          report_original_filename: string
          report_uploaded_at: string
          upload_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["total_loss_case_details_public"][]
        SetofOptions: {
          from: "*"
          to: "total_loss_case_details_public"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      finish_abandoned_anonymous_guest_cleanup_run: {
        Args: { cleanup_run_id: string; failed?: boolean }
        Returns: {
          blocked_count: number
          cancelled_count: number
          claimed_count: number
          completed_count: number
          eligible_count: number
          marked_count: number
          retry_count: number
          run_id: string
          run_status: string
        }[]
      }
      get_or_create_total_loss_draft: {
        Args: never
        Returns: {
          created_at: string
          id: string
          last_activity_at: string
          service_type: Database["public"]["Enums"]["appraisal_service_type"]
          status: Database["public"]["Enums"]["appraisal_case_status"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "appraisal_cases"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_owned_analysis_run: {
        Args: { run_id: string; user_id: string }
        Returns: Json
      }
      get_owned_total_loss_report_storage_locator: {
        Args: { case_id: string }
        Returns: {
          backup_object_path: string
          bucket_id: string
          canonical_object_path: string
          case_id: string
          finalized_upload_id: string
          storage_owner_id: string
        }[]
      }
      get_submitted_diminished_value_case: {
        Args: { requested_case_id: string }
        Returns: {
          accident_date: string
          accident_state: string
          airbag_deployment: string
          at_fault_insurer: string
          availability: string
          case_id: string
          created_at: string
          current_mileage: number
          draft_step: string
          email: string
          full_name: string
          major_repair_details: string
          mileage_at_accident: number
          notes: string
          other_party_at_fault: string
          owner_user_id: string
          phone: string
          preferred_contact_method: string
          repair_cost: number
          repair_facility: string
          repair_status: string
          revision: number
          service_type: Database["public"]["Enums"]["appraisal_service_type"]
          status: Database["public"]["Enums"]["appraisal_case_status"]
          structural_damage: string
          submitted_at: string
          updated_at: string
          vehicle_configuration: Json
          vehicle_entry_method: string
          vehicle_make: string
          vehicle_model: string
          vehicle_trim: string
          vehicle_year: number
          vin: string
        }[]
      }
      get_total_loss_analysis_status: {
        Args: { case_id: string; user_id: string }
        Returns: Database["public"]["CompositeTypes"]["total_loss_analysis_result"][]
        SetofOptions: {
          from: "*"
          to: "total_loss_analysis_result"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_total_loss_report_extraction: {
        Args: {
          analysis_input_revision: number
          case_id: string
          report_upload_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["total_loss_report_extraction_result"][]
        SetofOptions: {
          from: "*"
          to: "total_loss_report_extraction_result"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      has_current_customer_profile: { Args: never; Returns: boolean }
      invoke_abandoned_anonymous_guest_cleanup: { Args: never; Returns: number }
      is_abandoned_anonymous_guest_eligible: {
        Args: { candidate_user_id: string; observed_at?: string }
        Returns: boolean
      }
      is_current_auth_user_cleanup_frozen: { Args: never; Returns: boolean }
      is_permanent_total_loss_case_owner: {
        Args: { requested_case_id: string }
        Returns: boolean
      }
      is_venfour_staff: { Args: never; Returns: boolean }
      list_owned_case_operations: {
        Args: never
        Returns: {
          analysis_attempt_count: number
          analysis_failure_code: string
          analysis_processing_expires_at: string
          analysis_retryable: boolean
          analysis_status: Database["public"]["Enums"]["total_loss_analysis_status"]
          case_created_at: string
          case_id: string
          case_stage: Database["public"]["Enums"]["case_operation_stage"]
          case_status: Database["public"]["Enums"]["appraisal_case_status"]
          case_updated_at: string
          last_activity_at: string
          needs_attention: boolean
          owner_user_id: string
          report_uploaded_at: string
          service_type: Database["public"]["Enums"]["appraisal_service_type"]
        }[]
      }
      list_submitted_diminished_value_cases: {
        Args: never
        Returns: {
          accident_date: string
          at_fault_insurer: string
          case_id: string
          document_count: number
          email: string
          full_name: string
          owner_user_id: string
          phone: string
          preferred_contact_method: string
          service_type: Database["public"]["Enums"]["appraisal_service_type"]
          status: Database["public"]["Enums"]["appraisal_case_status"]
          submitted_at: string
          vehicle_make: string
          vehicle_model: string
          vehicle_year: number
        }[]
      }
      mark_abandoned_anonymous_guest_storage_deleted: {
        Args: { candidate_lease_token: string; candidate_user_id: string }
        Returns: boolean
      }
      mark_total_loss_report_upload_ready: {
        Args: { case_id: string; has_backup: boolean; upload_id: string }
        Returns: Database["public"]["CompositeTypes"]["total_loss_report_upload_lease"][]
        SetofOptions: {
          from: "*"
          to: "total_loss_report_upload_lease"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      persist_total_loss_report_extraction: {
        Args: {
          analysis_input_revision: number
          case_id: string
          confidence: number
          extraction_schema_version: string
          extraction_status: string
          normalized_report: Json
          provider_name: string
          report_upload_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["total_loss_report_extraction_result"][]
        SetofOptions: {
          from: "*"
          to: "total_loss_report_extraction_result"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      reclaim_total_loss_report_upload: {
        Args: {
          case_id: string
          expected_updated_at: string
          upload_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["total_loss_report_upload_lease"][]
        SetofOptions: {
          from: "*"
          to: "total_loss_report_upload_lease"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      release_vehicle_trim_cache: {
        Args: {
          requested_generation_token: string
          requested_lookup_key: string
        }
        Returns: boolean
      }
      renew_total_loss_report_upload: {
        Args: { case_id: string; upload_id: string }
        Returns: Database["public"]["CompositeTypes"]["total_loss_report_upload_lease"][]
        SetofOptions: {
          from: "*"
          to: "total_loss_report_upload_lease"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      retry_abandoned_anonymous_guest_cleanup_candidate: {
        Args: {
          candidate_lease_token: string
          candidate_user_id: string
          error_code: string
        }
        Returns: boolean
      }
      save_total_loss_contact_and_begin_claim: {
        Args: {
          case_id: string
          email: string
          full_name: string
          operational_follow_up_allowed: boolean
          privacy_notice_version: string
          service_terms_version: string
        }
        Returns: Database["public"]["CompositeTypes"]["total_loss_case_claim_begin_result"][]
        SetofOptions: {
          from: "*"
          to: "total_loss_case_claim_begin_result"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      save_total_loss_contact_details_and_begin_claim: {
        Args: {
          case_id: string
          email: string
          first_name: string
          last_name: string
          operational_follow_up_allowed: boolean
          phone_number: string
          privacy_notice_version: string
          service_terms_version: string
        }
        Returns: Database["public"]["CompositeTypes"]["total_loss_contact_details_claim_begin_result"][]
        SetofOptions: {
          from: "*"
          to: "total_loss_contact_details_claim_begin_result"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      staff_get_total_loss_case_operation: {
        Args: { requested_case_id: string }
        Returns: {
          analysis_attempt_count: number
          analysis_classification: string
          analysis_evidence_basis: string
          analysis_evidence_strength: string
          analysis_failure_code: string
          analysis_input_id: string
          analysis_input_revision: number
          analysis_job_created_at: string
          analysis_job_finished_at: string
          analysis_job_id: string
          analysis_job_updated_at: string
          analysis_processing_expires_at: string
          analysis_retryable: boolean
          analysis_run_created_at: string
          analysis_run_id: string
          analysis_run_schema_version: string
          analysis_status: Database["public"]["Enums"]["total_loss_analysis_status"]
          analysis_version: string
          case_created_at: string
          case_id: string
          case_stage: Database["public"]["Enums"]["case_operation_stage"]
          case_status: Database["public"]["Enums"]["appraisal_case_status"]
          case_updated_at: string
          comparable_scoring_version: string
          contact_email: string
          contact_email_verified: boolean
          contact_full_name: string
          customer_full_name: string
          date_of_loss: string
          details_created_at: string
          details_updated_at: string
          discrepancy_analysis_version: string
          identity_claimed_at: string
          insurer_name: string
          insurer_vehicle_valuation: number
          intake_completed_at: string
          intake_mode: Database["public"]["Enums"]["total_loss_intake_mode"]
          last_activity_at: string
          mileage_at_loss: number
          needs_attention: boolean
          operational_follow_up_allowed: boolean
          owner_is_anonymous: boolean
          owner_user_id: string
          postal_code: string
          report_extracted_at: string
          report_extraction_confidence: number
          report_extraction_status: string
          report_facts_confirmed_at: string
          report_original_filename: string
          report_provider_name: string
          report_storage_object_path: string
          report_storage_owner_id: string
          report_uploaded_at: string
          service_type: Database["public"]["Enums"]["appraisal_service_type"]
          vehicle_condition: string
          vehicle_make: string
          vehicle_model: string
          vehicle_options_packages: string
          vehicle_trim: string
          vehicle_year: number
          verified_email: string
          vin: string
        }[]
      }
      staff_list_case_operations: {
        Args: never
        Returns: {
          analysis_attempt_count: number
          analysis_failure_code: string
          analysis_processing_expires_at: string
          analysis_retryable: boolean
          analysis_status: Database["public"]["Enums"]["total_loss_analysis_status"]
          case_created_at: string
          case_id: string
          case_stage: Database["public"]["Enums"]["case_operation_stage"]
          case_status: Database["public"]["Enums"]["appraisal_case_status"]
          case_updated_at: string
          contact_email: string
          contact_email_verified: boolean
          contact_full_name: string
          customer_full_name: string
          identity_claimed_at: string
          last_activity_at: string
          needs_attention: boolean
          owner_is_anonymous: boolean
          owner_user_id: string
          report_uploaded_at: string
          service_type: Database["public"]["Enums"]["appraisal_service_type"]
          verified_email: string
        }[]
      }
      start_abandoned_anonymous_guest_storage_deletion: {
        Args: { candidate_lease_token: string; candidate_user_id: string }
        Returns: boolean
      }
      submit_diminished_value_case: {
        Args: { case_id: string }
        Returns: Database["public"]["CompositeTypes"]["diminished_value_submission_result"][]
        SetofOptions: {
          from: "*"
          to: "diminished_value_submission_result"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      total_loss_manual_input_is_complete: {
        Args: {
          details: Database["public"]["Tables"]["total_loss_case_details"]["Row"]
        }
        Returns: boolean
      }
      touch_appraisal_case: {
        Args: { case_id: string }
        Returns: {
          created_at: string
          id: string
          last_activity_at: string
          service_type: Database["public"]["Enums"]["appraisal_service_type"]
          status: Database["public"]["Enums"]["appraisal_case_status"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "appraisal_cases"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      vehicle_configuration_is_valid: {
        Args: { configuration: Json }
        Returns: boolean
      }
    }
    Enums: {
      appraisal_case_status:
        | "draft"
        | "submitted"
        | "checking"
        | "check_complete"
        | "payment_pending"
        | "paid"
        | "completed"
        | "closed"
      appraisal_service_type: "total_loss" | "diminished_value"
      case_entitlement_status:
        | "active"
        | "refunded_access_retained"
        | "suspended"
        | "revoked"
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
        | "needs_attention"
      commerce_order_status:
        | "pending"
        | "paid"
        | "partially_refunded"
        | "refunded"
        | "disputed"
        | "void"
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
        | "case_not_ready"
      total_loss_analysis_status: "processing" | "completed" | "failed"
      total_loss_claim_phase:
        | "review"
        | "initial_request"
        | "negotiation"
        | "resolution"
      total_loss_communication_channel:
        | "email"
        | "uploaded_document"
        | "pasted_message"
        | "phone"
      total_loss_communication_direction: "inbound" | "outbound"
      total_loss_intake_mode: "report" | "manual"
    }
    CompositeTypes: {
      diminished_value_submission_result: {
        case_id: string | null
        status: Database["public"]["Enums"]["appraisal_case_status"] | null
        submitted_at: string | null
        revision: number | null
      }
      total_loss_analysis_result: {
        outcome:
          | Database["public"]["Enums"]["total_loss_analysis_outcome"]
          | null
        job_id: string | null
        status: Database["public"]["Enums"]["total_loss_analysis_status"] | null
        attempt_count: number | null
        run_id: string | null
        postal_code: string | null
        failure_code: string | null
        retryable: boolean | null
        processing_expires_at: string | null
        intake_mode:
          | Database["public"]["Enums"]["total_loss_intake_mode"]
          | null
        source_report_upload_id: string | null
        analysis_input_revision: number | null
        analysis_input_id: string | null
        input_snapshot: Json | null
        storage_bucket: string | null
        storage_owner_id: string | null
        storage_object_path: string | null
        report_extraction_available: boolean | null
      }
      total_loss_case_claim_begin_result: {
        case_id: string | null
        full_name: string | null
        email: string | null
        email_verified_at: string | null
        service_terms_version: string | null
        service_terms_acknowledged_at: string | null
        privacy_notice_version: string | null
        privacy_notice_acknowledged_at: string | null
        operational_follow_up_allowed: boolean | null
        operational_follow_up_updated_at: string | null
        created_at: string | null
        updated_at: string | null
        claim_id: string | null
        claim_expires_at: string | null
      }
      total_loss_case_claim_result: {
        outcome: string | null
        case_id: string | null
        owner_user_id: string | null
        contact_email: string | null
        email_verified_at: string | null
        claimed_at: string | null
        ownership_transferred: boolean | null
      }
      total_loss_case_details_public: {
        case_id: string | null
        intake_mode:
          | Database["public"]["Enums"]["total_loss_intake_mode"]
          | null
        vin: string | null
        vehicle_year: number | null
        vehicle_make: string | null
        vehicle_model: string | null
        vehicle_trim: string | null
        mileage_at_loss: number | null
        postal_code: string | null
        date_of_loss: string | null
        insurer_name: string | null
        insurer_vehicle_valuation: number | null
        report_original_filename: string | null
        report_uploaded_at: string | null
        intake_completed_at: string | null
        created_at: string | null
        updated_at: string | null
      }
      total_loss_contact_details_claim_begin_result: {
        case_id: string | null
        first_name: string | null
        last_name: string | null
        full_name: string | null
        email: string | null
        phone_number: string | null
        email_verified_at: string | null
        service_terms_version: string | null
        service_terms_acknowledged_at: string | null
        privacy_notice_version: string | null
        privacy_notice_acknowledged_at: string | null
        operational_follow_up_allowed: boolean | null
        operational_follow_up_updated_at: string | null
        created_at: string | null
        updated_at: string | null
        claim_id: string | null
        claim_expires_at: string | null
      }
      total_loss_intake_confirmation_result: {
        case_id: string | null
        intake_mode:
          | Database["public"]["Enums"]["total_loss_intake_mode"]
          | null
        vin: string | null
        vehicle_year: number | null
        vehicle_make: string | null
        vehicle_model: string | null
        vehicle_trim: string | null
        mileage_at_loss: number | null
        postal_code: string | null
        date_of_loss: string | null
        insurer_name: string | null
        insurer_vehicle_valuation: number | null
        vehicle_condition: string | null
        vehicle_options_packages: string | null
        report_provider_name: string | null
        report_original_filename: string | null
        report_uploaded_at: string | null
        report_facts_confirmed_at: string | null
        intake_completed_at: string | null
        analysis_input_revision: number | null
        analysis_input_id: string | null
        updated_at: string | null
      }
      total_loss_report_extraction_result: {
        case_id: string | null
        report_upload_id: string | null
        analysis_input_revision: number | null
        provider_name: string | null
        extraction_status: string | null
        confidence: number | null
        extraction_schema_version: string | null
        normalized_report: Json | null
        extracted_at: string | null
        updated_at: string | null
      }
      total_loss_report_upload_lease: {
        upload_id: string | null
        expires_at: string | null
        details_updated_at: string | null
        report_original_filename: string | null
        report_uploaded_at: string | null
        recovery_required: boolean | null
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
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
      case_entitlement_status: [
        "active",
        "refunded_access_retained",
        "suspended",
        "revoked",
      ],
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
      commerce_order_status: [
        "pending",
        "paid",
        "partially_refunded",
        "refunded",
        "disputed",
        "void",
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
      total_loss_claim_phase: [
        "review",
        "initial_request",
        "negotiation",
        "resolution",
      ],
      total_loss_communication_channel: [
        "email",
        "uploaded_document",
        "pasted_message",
        "phone",
      ],
      total_loss_communication_direction: ["inbound", "outbound"],
      total_loss_intake_mode: ["report", "manual"],
    },
  },
} as const
