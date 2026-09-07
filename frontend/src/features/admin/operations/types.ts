export type AdminResource =
  | "cases"
  | "customers"
  | "reports"
  | "processing"
  | "payments"
  | "activity";

export interface AdminFact {
  readonly label: string;
  readonly value: string | null;
}

export interface AdminSection {
  readonly title: string;
  readonly facts: readonly AdminFact[];
}

/** Curated operational metadata selected by the staff-authorized database projection. */
export interface AdminRow {
  readonly id: string;
  readonly caseId: string | null;
  readonly customerId: string | null;
  readonly title: string;
  readonly subtitle: string | null;
  readonly summary: string | null;
  readonly status: string;
  readonly kind: string;
  readonly identity: "account" | "guest" | null;
  readonly verified: boolean | null;
  readonly caseCount: number | null;
  readonly attentionReasons: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly facts: readonly AdminFact[];
  readonly sections: readonly AdminSection[];
}

export interface AdminListOptions {
  readonly search?: string;
  readonly filters?: Readonly<Record<string, string>>;
  readonly sort?: "updated" | "created";
  readonly page?: number;
  readonly pageSize?: number;
}

export interface AdminPage {
  readonly items: readonly AdminRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly asOf: string;
}

export interface AdminOverview {
  readonly asOf: string;
  readonly activeCases: number;
  readonly attentionCases: number;
  readonly processingJobs: number;
  readonly registeredAccounts: number;
  readonly attention: readonly AdminRow[];
  readonly activity: readonly AdminRow[];
}

export interface AdminOperationsService {
  list(resource: AdminResource, options?: AdminListOptions): Promise<AdminPage>;
  overview(): Promise<AdminOverview>;
  customer(id: string): Promise<AdminRow | null>;
  case(id: string): Promise<AdminRow | null>;
  record(resource: AdminResource, id: string): Promise<AdminRow | null>;
}
