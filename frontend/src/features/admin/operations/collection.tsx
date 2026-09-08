import { SlidersHorizontal } from "lucide-react";
import { useId, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { useAdminCaseOperationsDependencies } from "@/features/admin/case-operations/dependencies";
import { formatCaseOperationDateTime, formatCaseOperationReference } from "@/features/admin/case-operations/format";

import { useAdminList, useAdminRecord } from "./queries";
import type { AdminRow } from "./types";
import { adminRecordColumns } from "./record-columns";
import { AdminEmptyState, AdminErrorState, AdminLoadingState, AdminRefreshNotice, AdminPageHeader, AdminPagination, AdminSearch, AdminSelect, AdminTable } from "./page-ui";
import { adminActivityTitle, adminCaseHref, formatAdminFact, humanizeAdminCode } from "./ui-format";

export type AdminCollectionResource = "cases" | "customers" | "reports" | "processing" | "payments" | "activity";
export interface AdminFilterDefinition { readonly key: string; readonly label: string; readonly options: readonly { readonly value: string; readonly label: string }[] }

const commonFilters = ["status", "kind", "identity", "verified", "hasCases", "attention", "active", "customerId", "caseId"] as const;
const pageSize = 50;

export function AdminCollection({ resource, title, description, searchPlaceholder = "Search records", filters = [], fixedFilters = {}, defaultFilters = {}, embedded = false }: {
  readonly resource: AdminCollectionResource;
  readonly title: string;
  readonly description: string;
  readonly searchPlaceholder?: string;
  readonly filters?: readonly AdminFilterDefinition[];
  readonly fixedFilters?: Readonly<Record<string, string>>;
  readonly defaultFilters?: Readonly<Record<string, string>>;
  readonly embedded?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const filterId = useId();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const dependencies = useAdminCaseOperationsDependencies();
  const location = useLocation();
  const search = (params.get("q") ?? "").slice(0, 200);
  const sort = params.get("sort") === "created" ? "created" : "updated";
  const parsedPage = Number(params.get("page") ?? "1");
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 && parsedPage <= 1_000_000 ? parsedPage : 1;
  const selectedFilters: Record<string, string> = {};
  for (const key of commonFilters) {
    const value = params.get(key) ?? defaultFilters[key];
    if (!value || value === "all" || value.length > 128) continue;
    if ((key === "caseId" || key === "customerId") && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)) continue;
    if (key === "identity" && value !== "account" && value !== "guest") continue;
    if (["verified", "hasCases", "attention", "active"].includes(key) && value !== "true" && value !== "false") continue;
    if ((key === "status" || key === "kind") && !/^[a-zA-Z][a-zA-Z0-9_.-]{0,99}$/u.test(value)) continue;
    selectedFilters[key] = value;
  }
  if (params.get("view") === "attention") selectedFilters.attention = "true";
  Object.assign(selectedFilters, fixedFilters);
  const query = useAdminList(resource, { search, sort, page, pageSize, filters: selectedFilters });
  const activeFilterCount = Object.entries(selectedFilters).filter(([key, value]) => fixedFilters[key] !== value && defaultFilters[key] !== value).length;
  const hasFilters = Boolean(search || Object.entries(selectedFilters).some(([key, value]) => fixedFilters[key] !== value && defaultFilters[key] !== value));
  function setParameter(key: string, value: string) {
    setParams(previous => { const next = new URLSearchParams(previous); if (value) next.set(key, value); else next.delete(key); if (key !== "page") next.delete("page"); if (key === "attention") next.delete("view"); return next; }, { replace: key === "q" });
  }
  function clearFilters() {
    setParams(previous => { const next = new URLSearchParams(previous); for (const key of ["q", "page", "view", ...commonFilters]) next.delete(key); return next; });
  }
  if (!dependencies?.operationsService) return <AdminEmptyState title="Operations unavailable" description="The staff operations service is not configured for this environment." />;
  const origin = `${location.pathname}${location.search}`;
  const columns = adminRecordColumns({ resource, origin, sort, expandedId, onToggle: id => setExpandedId(current => current === id ? null : id) });
  return <section className={embedded ? "admin-embedded-collection" : "admin-page"} aria-label={title} data-resource={resource}>
    {!embedded ? <AdminPageHeader title={params.get("view") === "attention" && resource === "cases" ? "Needs attention" : title} description={description} refreshing={query.isFetching} onRefresh={() => void query.refetch()} /> : <div className="admin-panel-header"><div><h2>{title}</h2><p>{description}</p></div><Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh</Button></div>}
    <div className="admin-collection-surface">
    <div className="admin-toolbar"><div className="admin-search-tools"><AdminSearch value={search} onChange={value => setParameter("q", value)} label={`Search ${title.toLowerCase()}`} placeholder={searchPlaceholder} /><Button variant="outline" className="admin-filter-toggle" aria-label={activeFilterCount ? `Filters (${activeFilterCount} active)` : "Filters"} aria-expanded={filtersOpen} aria-controls={filterId} onClick={() => setFiltersOpen(open => !open)}><SlidersHorizontal size={15} aria-hidden />Filters{activeFilterCount ? <span>{activeFilterCount}</span> : null}</Button></div><div className="admin-filter-row" id={filterId} data-open={filtersOpen}>{filters.map(filter => <AdminSelect key={filter.key} label={filter.label} value={filter.key === "attention" && params.get("view") === "attention" ? "true" : params.get(filter.key) ?? defaultFilters[filter.key] ?? ""} onChange={value => setParameter(filter.key, value)} options={filter.options} />)}<AdminSelect label="Sort records" value={sort} onChange={value => setParameter("sort", value)} options={[{ value: "updated", label: "Recently updated" }, { value: "created", label: "Recently created" }]} />{hasFilters ? <Button variant="ghost" onClick={clearFilters}>Clear filters</Button> : null}</div></div>
    {query.isError && query.data ? <AdminRefreshNotice /> : null}
    {query.isPending ? <AdminLoadingState label={`Loading ${title.toLowerCase()}…`} /> : query.isError && !query.data ? <AdminErrorState onRetry={() => void query.refetch()} /> : query.data.items.length === 0 ? <AdminEmptyState title={hasFilters ? "No matching records" : resource === "payments" && fixedFilters.caseId ? "No purchase started." : `No ${title.toLowerCase()}`} description={hasFilters ? "Try a different search or clear your filters." : resource === "payments" && fixedFilters.caseId ? "No order has been recorded for this case." : "Records will appear here when there is activity to inspect."} action={hasFilters ? <Button variant="outline" onClick={clearFilters}>Clear filters</Button> : undefined} /> : <><p className="admin-results-count" role="status">{query.data.total} {query.data.total === 1 ? "record" : "records"}<span> · Updated {formatCaseOperationDateTime(query.data.asOf)}</span></p><AdminTable label={title} items={query.data.items} columns={columns} itemKey={item => item.id} expandedItemKey={expandedId} renderExpanded={item => <AdminRecordDetails resource={resource} id={item.id} />} /></>}
    {query.data ? <AdminPagination page={page} pageSize={query.data.pageSize} total={query.data.total} fetching={query.isFetching} onPageChange={value => setParameter("page", String(value))} /> : null}
    </div>
  </section>;
}

function ArrowIcon() { return <span aria-hidden>↗</span>; }

function AdminRecordDetails({ resource, id }: { readonly resource: AdminCollectionResource; readonly id: string }) {
  const query = useAdminRecord(resource, id);
  const regionId = `admin-record-${resource}-${id}`;
  if (query.isPending) return <div className="admin-record-details" id={regionId}><AdminLoadingState label="Loading record details…" /></div>;
  if (query.isError && !query.data) return <div className="admin-record-details" id={regionId}><AdminErrorState description="The record details could not be loaded. Try again to inspect this record." onRetry={() => void query.refetch()} /></div>;
  if (!query.data) return <div className="admin-record-details" id={regionId}><AdminEmptyState title="Record unavailable" description="This record could not be found or is no longer available to your staff account." /></div>;
  const item = query.data;
  return <div className="admin-record-details" id={regionId}>
    <div className="admin-panel-header"><h3>{resource === "activity" ? adminActivityTitle(item.title) : item.title}</h3><Button variant="outline" size="sm" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh details</Button></div>
    {query.isError ? <AdminRefreshNotice /> : null}
    <RecordFacts item={item} />
    {item.caseId ? <Link className="admin-row-link" to={adminCaseHref(item.caseId, resource === "customers" || resource === "cases" ? "overview" : resource)}>Open case #{formatCaseOperationReference(item.caseId)}<ArrowIcon /></Link> : null}
  </div>;
}

export function RecordFacts({ item }: { readonly item: AdminRow }) {
  return <>{item.attentionReasons.length ? <div className="admin-notice"><div><strong>Needs attention</strong>{item.attentionReasons.map(reason => <p key={reason}>{humanizeAdminCode(reason)}</p>)}</div></div> : null}{item.facts.length ? <RecordFactGroup facts={item.facts} /> : null}{item.sections.map((section, index) => section.title === "Technical details" ? <details className="admin-technical-details" key={`${section.title}-${index}`}><summary>{section.title}</summary><RecordFactList facts={section.facts} /></details> : <section className="admin-record-section" key={`${section.title}-${index}`}><h3>{section.title.split(" · ").map((part, partIndex) => partIndex === 0 ? part : humanizeAdminCode(part)).join(" · ")}</h3><RecordFactGroup facts={section.facts} /></section>)}</>;
}

function RecordFactGroup({ facts }: { readonly facts: AdminRow["facts"] }) {
  const operational = facts.filter(fact => !isTechnicalFact(fact));
  const technical = facts.filter(isTechnicalFact);
  return <>{operational.length ? <RecordFactList facts={operational} /> : null}{technical.length ? <details className="admin-technical-details"><summary>Technical details</summary><RecordFactList facts={technical} /></details> : null}</>;
}

function isTechnicalFact(fact: AdminRow["facts"][number]) {
  if (/\b(?:ID|identifier)$|storage|\brevision\b/iu.test(fact.label)) return true;
  if (fact.value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(fact.value)) return true;
  return /\bversion\b/iu.test(fact.label) && !["version", "current version", "current published version"].includes(fact.label.toLowerCase());
}

function RecordFactList({ facts }: { readonly facts: AdminRow["facts"] }) {
  return <dl className="admin-detail-grid">{facts.map((fact, index) => <div className="admin-detail-field" key={`${fact.label}-${index}`}><dt>{fact.label}</dt><dd className={/\bID$|Storage object/iu.test(fact.label) ? "font-mono break-all" : undefined}>{formatAdminFact(fact.label, fact.value)}</dd></div>)}</dl>;
}
