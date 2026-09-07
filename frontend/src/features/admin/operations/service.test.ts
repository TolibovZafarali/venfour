import { createClient } from "@supabase/supabase-js";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import type { Database, Json } from "@/lib/supabase/database.types";
import { server } from "@/test/mocks/server";

import { AdminOperationsResponseError, createAdminOperationsService, isAdminAuthorizationError } from "./service";
import type { AdminListOptions } from "./types";

const URL = "https://admin-operations-test.supabase.co";
const CASE_ID = "11111111-aaaa-4111-8111-111111111111";
const CUSTOMER_ID = "22222222-bbbb-4222-8222-222222222222";
const OTHER_ID = "33333333-cccc-4333-8333-333333333333";
const TIME = "2026-09-07T12:00:00.000Z";

function service() {
  return createAdminOperationsService(createClient<Database>(URL, "sb_publishable_operations_test", {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  }));
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: CASE_ID,
    caseId: CASE_ID,
    customerId: CUSTOMER_ID,
    title: "Ada Lovelace",
    subtitle: "ada@example.com",
    summary: "2022 Honda Accord",
    status: "awaiting_insurer_response",
    kind: "total_loss",
    identity: "account",
    verified: true,
    caseCount: null,
    attentionReasons: [],
    createdAt: TIME,
    updatedAt: TIME,
    facts: [{ label: "Contact email", value: "Entered by customer" }],
    sections: [{ title: "Technical details", facts: [{ label: "Case ID", value: CASE_ID }] }],
    ...overrides,
  };
}

function page(items = [row()], overrides: Record<string, unknown> = {}) {
  return { items, total: items.length, page: 1, pageSize: 50, asOf: TIME, ...overrides };
}

function respond(name: string, data: unknown) {
  server.use(http.post(`${URL}/rest/v1/rpc/${name}`, () => HttpResponse.json(data as Json)));
}

describe("staff operations read service", () => {
  it("passes bounded filters and returns the authoritative stage without reconstructing it", async () => {
    let body: unknown;
    server.use(http.post(`${URL}/rest/v1/rpc/staff_admin_list`, async ({ request }) => {
      body = await request.json();
      return HttpResponse.json(page());
    }));
    const result = await service().list("cases", { search: "  Ada  ", filters: { attention: "false", customerId: CUSTOMER_ID.toUpperCase() } });
    expect(body).toEqual({ resource: "cases", search: "Ada", filters: { attention: "false", customerId: CUSTOMER_ID }, sort: "updated", page: 1, page_size: 50 });
    expect(result.items[0]).toMatchObject({ status: "awaiting_insurer_response", attentionReasons: [], facts: [{ label: "Contact email", value: "Entered by customer" }] });
  });

  it("keeps complete counts for an empty page beyond the last result", async () => {
    respond("staff_admin_list", page([], { total: 3, page: 2 }));
    await expect(service().list("cases", { page: 2 })).resolves.toMatchObject({ items: [], total: 3, page: 2, asOf: TIME });
  });

  it.each([
    ["a token-bearing extra field", { accessToken: "hidden" }],
    ["raw event JSON", { details: { message: "hidden" } }],
    ["unsafe nested facts", { facts: [{ label: "Status", value: "Ready", token: "hidden" }] }],
    ["unknown identity", { identity: "staff" }],
    ["negative account count", { caseCount: -1 }],
    ["invalid timestamp", { updatedAt: "yesterday" }],
    ["a diminished-value record", { kind: "diminished_value" }],
    ["a missing case scope", { caseId: null }],
  ])("rejects %s", async (_label, overrides) => {
    respond("staff_admin_list", page([row(overrides)]));
    await expect(service().list("cases")).rejects.toBeInstanceOf(AdminOperationsResponseError);
  });

  it("rejects records outside an explicitly requested case", async () => {
    respond("staff_admin_list", page([row({ kind: "uploaded" })]));
    await expect(service().list("reports", { filters: { caseId: OTHER_ID } })).rejects.toBeInstanceOf(AdminOperationsResponseError);
  });

  it.each([
    ["a false total", page([row()], { total: 0 })],
    ["a partial page with a complete count", page([row()], { total: 2 })],
    ["wrong page", page([row()], { page: 2 })],
    ["wrong page size", page([row()], { pageSize: 100 })],
    ["duplicate IDs", page([row(), row()])],
  ])("rejects %s", async (_label, data) => {
    respond("staff_admin_list", data);
    await expect(service().list("cases")).rejects.toBeInstanceOf(AdminOperationsResponseError);
  });

  it.each<AdminListOptions>([
    { pageSize: 101 },
    { page: 0 },
    { search: "x".repeat(201) },
    { filters: { sql: "true" } },
    { filters: { caseId: "../other" } },
    { filters: { verified: "yes" } },
  ])("rejects unsafe request options before a request: %j", async (options) => {
    await expect(service().list("cases", options)).rejects.toBeInstanceOf(AdminOperationsResponseError);
  });

  it("retains account identity and profiles for accounts with no cases", async () => {
    const customer = row({ id: CUSTOMER_ID, caseId: null, kind: "account", summary: null, status: "verified", caseCount: 0 });
    respond("staff_admin_customer", customer);
    await expect(service().customer(CUSTOMER_ID.toUpperCase())).resolves.toMatchObject({ id: CUSTOMER_ID, customerId: CUSTOMER_ID, caseCount: 0, identity: "account" });
  });

  it.each(["customer", "case"] as const)("returns null for an unavailable %s", async (method) => {
    respond(`staff_admin_${method}`, null);
    await expect(service()[method](CASE_ID)).resolves.toBeNull();
  });

  it("rejects customer records belonging to another UUID even with the same email", async () => {
    respond("staff_admin_customer", row({ id: OTHER_ID, customerId: OTHER_ID, caseId: null, kind: "account" }));
    await expect(service().customer(CUSTOMER_ID)).rejects.toBeInstanceOf(AdminOperationsResponseError);
  });

  it("rejects case supplements outside the requested case", async () => {
    respond("staff_admin_case", row({ id: OTHER_ID, caseId: OTHER_ID }));
    await expect(service().case(CASE_ID)).rejects.toBeInstanceOf(AdminOperationsResponseError);
  });

  it("requests one expanded report record and validates its full metadata", async () => {
    let body: unknown;
    server.use(http.post(`${URL}/rest/v1/rpc/staff_admin_record`, async ({ request }) => {
      body = await request.json();
      return HttpResponse.json(row({ id: `upload:${CASE_ID}`, kind: "uploaded", status: "uploaded" }));
    }));
    const record = await service().record("reports", `upload:${CASE_ID}`);
    expect(body).toEqual({ resource: "reports", requested_record_id: `upload:${CASE_ID}` });
    expect(record?.sections).toHaveLength(1);
  });

  it("rejects expanded details belonging to a different resource or record", async () => {
    respond("staff_admin_record", row({ kind: "uploaded" }));
    await expect(service().record("payments", CASE_ID)).rejects.toBeInstanceOf(AdminOperationsResponseError);
    await expect(service().record("reports", OTHER_ID)).rejects.toBeInstanceOf(AdminOperationsResponseError);
    await expect(service().record("cases", CASE_ID)).rejects.toBeInstanceOf(AdminOperationsResponseError);
    await expect(service().record("reports", " ")).rejects.toBeInstanceOf(AdminOperationsResponseError);
  });

  it("returns unavailable when an expanded record is absent", async () => {
    respond("staff_admin_record", null);
    await expect(service().record("activity", CASE_ID)).resolves.toBeNull();
  });

  it("preserves complete overview counts and bounded investigation lists", async () => {
    respond("staff_admin_overview", {
      asOf: TIME, activeCases: 130, attentionCases: 11, processingJobs: 8, registeredAccounts: 170,
      attention: [row({ attentionReasons: ["Report review hold"] })],
      activity: [row({ id: OTHER_ID, kind: "workflow_event", status: "customer_reported_sent" })],
    });
    await expect(service().overview()).resolves.toMatchObject({ activeCases: 130, attentionCases: 11, processingJobs: 8, registeredAccounts: 170 });
  });

  it("exposes only read operations", () => {
    expect(Object.keys(service()).sort()).toEqual(["case", "customer", "list", "overview", "record"]);
  });

  it("preserves authorization errors for immediate cache invalidation", async () => {
    server.use(http.post(`${URL}/rest/v1/rpc/staff_admin_list`, () => HttpResponse.json({ code: "42501", message: "Staff access required" }, { status: 403 })));
    await expect(service().list("cases")).rejects.toMatchObject({ code: "42501" });
    expect(isAdminAuthorizationError({ code: "42501" })).toBe(true);
    expect(isAdminAuthorizationError({ status: 401 })).toBe(true);
    expect(isAdminAuthorizationError({ code: "PGRST301" })).toBe(true);
    expect(isAdminAuthorizationError(new Error("Connection failed"))).toBe(false);
  });
});
