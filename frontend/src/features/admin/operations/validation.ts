import type {
  AdminFact,
  AdminListOptions,
  AdminOverview,
  AdminPage,
  AdminResource,
  AdminRow,
  AdminSection,
} from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const CODE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/u;
const RESOURCES = new Set<AdminResource>(["cases", "customers", "reports", "processing", "payments", "activity"]);
const FILTERS = new Set(["caseId", "customerId", "status", "kind", "identity", "verified", "hasCases", "attention", "active"]);
const ROW_FIELDS = ["id", "caseId", "customerId", "title", "subtitle", "summary", "status", "kind", "identity", "verified", "caseCount", "attentionReasons", "createdAt", "updatedAt", "facts", "sections"];

export class AdminOperationsResponseError extends Error {
  constructor(message = "The staff service returned an invalid operational record.") {
    super(message);
    this.name = "AdminOperationsResponseError";
  }
}

function invalid(field: string): never {
  throw new AdminOperationsResponseError(`The staff service returned an invalid ${field}.`);
}

function record(value: unknown, fields: readonly string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field);
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some((key) => !fields.includes(key)) || fields.some((key) => !Object.hasOwn(row, key))) invalid(field);
  return row;
}

function text(value: unknown, field: string, nullable = false): string {
  if (typeof value !== "string" || (!nullable && !value.trim()) || value.length > 16_384) invalid(field);
  return value;
}

function nullableText(value: unknown, field: string) {
  return value === null ? null : text(value, field, true);
}

function integer(value: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) invalid(field);
  return value;
}

function timestamp(value: unknown, field: string) {
  const result = text(value, field);
  if (!TIMESTAMP_PATTERN.test(result) || !Number.isFinite(Date.parse(result))) invalid(field);
  return result;
}

export function normalizeAdminUuid(value: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new AdminOperationsResponseError("The requested record ID must be a valid UUID.");
  }
  return value.toLowerCase();
}

export function normalizeAdminRecordRequest(resource: AdminResource, id: string) {
  if (!["reports", "processing", "payments", "activity"].includes(resource)) {
    throw new AdminOperationsResponseError("The requested staff record resource is unavailable.");
  }
  if (typeof id !== "string" || !id.trim() || id.length > 512) {
    throw new AdminOperationsResponseError("The requested staff record ID is invalid.");
  }
  return { resource, id };
}

function nullableUuid(value: unknown, field: string) {
  return value === null ? null : normalizeAdminUuid(text(value, field));
}

function array<T>(value: unknown, field: string, map: (item: unknown) => T, limit: number): T[] {
  if (!Array.isArray(value) || value.length > limit) invalid(field);
  return value.map(map);
}

function fact(value: unknown): AdminFact {
  const row = record(value, ["label", "value"], "fact");
  return { label: text(row.label, "fact label"), value: nullableText(row.value, "fact value") };
}

function section(value: unknown): AdminSection {
  const row = record(value, ["title", "facts"], "section");
  return { title: text(row.title, "section title"), facts: array(row.facts, "section facts", fact, 1000) };
}

export function parseAdminRow(value: unknown): AdminRow {
  const row = record(value, ROW_FIELDS, "operational row");
  const identity = row.identity;
  if (identity !== null && identity !== "account" && identity !== "guest") invalid("identity");
  const verified = row.verified;
  if (verified !== null && typeof verified !== "boolean") invalid("verification state");
  const id = text(row.id, "record ID");
  if (id.length > 512) invalid("record ID");
  const status = text(row.status, "status");
  const kind = text(row.kind, "kind");
  if (!CODE_PATTERN.test(status) || !CODE_PATTERN.test(kind)) invalid("record classification");
  return {
    id,
    caseId: nullableUuid(row.caseId, "case ID"),
    customerId: nullableUuid(row.customerId, "customer ID"),
    title: text(row.title, "title"),
    subtitle: nullableText(row.subtitle, "subtitle"),
    summary: nullableText(row.summary, "summary"),
    status,
    kind,
    identity,
    verified,
    caseCount: row.caseCount === null ? null : integer(row.caseCount, "case count"),
    attentionReasons: array(row.attentionReasons, "attention reasons", (item) => text(item, "attention reason"), 100),
    createdAt: timestamp(row.createdAt, "creation timestamp"),
    updatedAt: timestamp(row.updatedAt, "update timestamp"),
    facts: array(row.facts, "facts", fact, 1000),
    sections: array(row.sections, "sections", section, 1000),
  };
}

export function normalizeAdminListOptions(resource: AdminResource, options: AdminListOptions = {}): Required<AdminListOptions> {
  if (!RESOURCES.has(resource)) throw new AdminOperationsResponseError("The requested staff resource is unavailable.");
  const rawSearch = options.search ?? "";
  if (typeof rawSearch !== "string" || rawSearch.length > 200) throw new AdminOperationsResponseError("Search must contain at most 200 characters.");
  const search = rawSearch.trim();
  const filters: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.filters ?? {})) {
    if (!FILTERS.has(key) || typeof value !== "string" || value.length > 128) throw new AdminOperationsResponseError("The requested staff filter is invalid.");
    if (!value) continue;
    if (key === "caseId" || key === "customerId") filters[key] = normalizeAdminUuid(value);
    else if (key === "identity") {
      if (value !== "account" && value !== "guest") throw new AdminOperationsResponseError("The requested identity filter is invalid.");
      filters[key] = value;
    } else if (["verified", "hasCases", "attention", "active"].includes(key)) {
      if (value !== "true" && value !== "false") throw new AdminOperationsResponseError("The requested staff filter is invalid.");
      filters[key] = value;
    } else {
      if (!CODE_PATTERN.test(value) || value.length > 100) throw new AdminOperationsResponseError("The requested staff filter is invalid.");
      filters[key] = value;
    }
  }
  const sort = options.sort ?? "updated";
  if (sort !== "updated" && sort !== "created") throw new AdminOperationsResponseError("The requested staff sort is invalid.");
  return {
    search,
    filters,
    sort,
    page: integer(options.page ?? 1, "page", 1, 1_000_000),
    pageSize: integer(options.pageSize ?? 50, "page size", 1, 100),
  };
}

export function assertAdminResourceScope(row: AdminRow, resource: AdminResource) {
  const kinds: Record<AdminResource, readonly string[]> = {
    cases: ["total_loss"],
    customers: ["account", "guest"],
    reports: ["uploaded", "generated"],
    processing: ["initial_analysis", "paid_package", "insurer_response"],
    payments: ["order"],
    activity: ["workflow_event"],
  };
  if (!kinds[resource].includes(row.kind)) invalid("resource scope");
  if (resource === "customers" ? row.customerId === null : row.caseId === null) invalid("record scope");
}

export function parseAdminPage(value: unknown, resource: AdminResource, options: Required<AdminListOptions>): AdminPage {
  const row = record(value, ["items", "total", "page", "pageSize", "asOf"], "page");
  const items = array(row.items, "page items", parseAdminRow, 100);
  const total = integer(row.total, "total count");
  const page = integer(row.page, "page", 1);
  const pageSize = integer(row.pageSize, "page size", 1, 100);
  const expectedSize = Math.min(pageSize, Math.max(0, total - (page - 1) * pageSize));
  if (page !== options.page || pageSize !== options.pageSize || items.length !== expectedSize) invalid("pagination");
  if (new Set(items.map((item) => item.id)).size !== items.length) invalid("duplicate record ID");
  for (const item of items) {
    assertAdminResourceScope(item, resource);
    if (options.filters.caseId && item.caseId !== options.filters.caseId) invalid("case scope");
    if (options.filters.customerId && item.customerId !== options.filters.customerId) invalid("customer scope");
  }
  return { items, total, page, pageSize, asOf: timestamp(row.asOf, "retrieval timestamp") };
}

export function parseAdminOverview(value: unknown): AdminOverview {
  const row = record(value, ["asOf", "activeCases", "attentionCases", "processingJobs", "registeredAccounts", "attention", "activity"], "overview");
  const attention = array(row.attention, "attention cases", parseAdminRow, 5);
  const activity = array(row.activity, "recent activity", parseAdminRow, 8);
  for (const item of attention) {
    assertAdminResourceScope(item, "cases");
    if (!item.attentionReasons.length) invalid("attention case");
  }
  for (const item of activity) assertAdminResourceScope(item, "activity");
  const attentionCases = integer(row.attentionCases, "attention case count");
  if (attention.length > attentionCases) invalid("attention case count");
  return {
    asOf: timestamp(row.asOf, "retrieval timestamp"),
    activeCases: integer(row.activeCases, "active case count"),
    attentionCases,
    processingJobs: integer(row.processingJobs, "processing job count"),
    registeredAccounts: integer(row.registeredAccounts, "registered account count"),
    attention,
    activity,
  };
}
