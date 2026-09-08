import { FileText } from "lucide-react";
import { Link } from "react-router";
import type { AdminCollectionResource } from "./collection";
import { AdminBadge } from "./page-ui";
import type { AdminRow } from "./types";
import { adminCaseHref, adminFactValue as factValue, adminStatusTone, formatAdminFact, humanizeAdminCode } from "./ui-format";
import { formatCaseOperationDateTime, formatCaseOperationReference } from "@/features/admin/case-operations/format";

export function AdminRecordTime({ value }: { readonly value: string }) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return <span>Not recorded</span>;
  return <time className="admin-record-time" dateTime={value} title={formatCaseOperationDateTime(value)}>
    <span>{date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
    <span>{date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
  </time>;
}

export function AdminPersonMark({ name }: { readonly name: string }) {
  const initials = name.trim().split(/\s+/u).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  return <span className="admin-person-mark" aria-hidden>{initials || "—"}</span>;
}


export function Fact({ item, label }: { readonly item: AdminRow; readonly label: string }) {
  return <span>{formatAdminFact(label, factValue(item, label) ?? null)}</span>;
}
export function Identity({ item, resource }: { readonly item: AdminRow; readonly resource: AdminCollectionResource }) {
  const person = resource === "customers" || resource === "cases";
  const href = person && item.customerId ? `/admin/customers/${encodeURIComponent(item.customerId)}` : null;
  return <div className="admin-record-identity">{person ? <AdminPersonMark name={item.title} /> : resource === "reports" ? <span className="admin-document-mark"><FileText size={18} aria-hidden /></span> : null}<div>
    <div className="admin-primary-text">{href ? <Link to={href}>{item.title}</Link> : item.title}</div>
    {item.subtitle ? <p className="admin-secondary-text admin-record-subtitle" title={item.subtitle}>{item.subtitle}</p> : null}
    {resource === "cases" && item.identity ? <p className="admin-identity-note">{item.identity === "guest" ? "Guest · access unclaimed" : "Registered account"}</p> : null}
    {!person && item.summary ? <p className="admin-identity-note">{item.summary}</p> : null}
  </div></div>;
}
export function CaseLink({ item, tab = "overview", returnTo }: { readonly item: AdminRow; readonly tab?: string; readonly returnTo?: string }) {
  return item.caseId ? <Link className="admin-case-reference" to={adminCaseHref(item.caseId, tab, returnTo)}>#{formatCaseOperationReference(item.caseId)}</Link> : <span className="admin-secondary-text">Not recorded</span>;
}
export function Status({ item }: { readonly item: AdminRow }) {
  return <AdminBadge tone={adminStatusTone(item.status)}>{humanizeAdminCode(item.status)}</AdminBadge>;
}
export function Attention({ item }: { readonly item: AdminRow }) {
  return item.attentionReasons.length ? <div className="admin-issue-text"><span className="admin-status-dot" /><span className="sr-only">Needs attention: </span>{item.attentionReasons.map(humanizeAdminCode).join(" · ")}</div> : <span className="admin-secondary-text">No recorded issues</span>;
}
