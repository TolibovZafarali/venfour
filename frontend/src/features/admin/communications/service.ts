import { environment } from "@/config/env";
import { createApiClient } from "@/lib/api/client";

export interface EmailTemplate {
  key: string;
  subject: string;
  heading: string;
  paragraphs: string[];
  action: string;
  category: string;
  identity: string;
  trigger: string;
  version: string;
}
export interface EmailAutomation {
  template_key: string;
  enabled: boolean;
  delay_seconds: number;
  category: string;
  revision: number;
}
export interface EmailActivity {
  id: string;
  source: string;
  template_key: string;
  status: string;
  attempts: number;
  created_at: string;
  accepted_at?: string;
  delivery_status?: string;
  error_code?: string;
}
export interface CommunicationsOverview {
  settings: {
    mode: "disabled" | "dry_run" | "live";
    enrolled_after: string | null;
    activated_at: string | null;
    revision: number;
  };
  automations: EmailAutomation[];
  templates: EmailTemplate[];
  activity: EmailActivity[];
  partner_activity: EmailActivity[];
  preview_activity: EmailActivity[];
  suppression_count: number;
  configuration: {
    provider: string;
    mode: string;
    error: string | null;
    auth_hook_enabled: boolean;
    webhook_configured: boolean;
    test_send_configured: boolean;
    app_origin: string;
    identities: { name: string; from: string; reply_to: string }[];
  };
}
export interface EmailPreview {
  html: string;
  text: string;
  subject: string;
  version: string;
}
export function createCommunicationsService(
  baseUrl = environment.apiBaseUrl,
  fetchImplementation?: typeof fetch,
) {
  const client = createApiClient({ baseUrl, fetchImplementation });
  const path = "/api/v1/staff/communications";
  return {
    overview(accessToken: string, signal?: AbortSignal) {
      return client.getAuthenticated<CommunicationsOverview>(path, {
        accessToken,
        signal,
      });
    },
    operation<T>(
      accessToken: string,
      action: string,
      payload: Record<string, unknown>,
      signal?: AbortSignal,
    ) {
      return client.postJson<T>(
        path,
        { action, payload },
        { accessToken, signal },
      );
    },
  };
}
export const communicationsService = createCommunicationsService();
