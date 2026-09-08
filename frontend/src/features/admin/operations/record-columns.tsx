import { ArrowUpRight, ChevronDown, ChevronUp } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import type { AdminCollectionResource } from "./collection";
import { AdminBadge, type AdminTableColumn } from "./page-ui";
import type { AdminRow } from "./types";
import { AdminRecordTime, Fact, Identity, CaseLink, Status, Attention } from "./record-presentation";
import { adminActivityTitle, adminCaseHref, adminFactValue as factValue, humanizeAdminCode } from "./ui-format";

export function adminRecordColumns({ resource, origin, sort, expandedId, onToggle }: {
  readonly resource: AdminCollectionResource;
  readonly origin: string;
  readonly sort: string;
  readonly expandedId: string | null;
  readonly onToggle: (id: string) => void;
}): readonly AdminTableColumn<AdminRow>[] {
  const identity = (label: string): AdminTableColumn<AdminRow> => ({ key: "identity", label, render: item => <Identity item={item} resource={resource} /> });
  const caseColumn: AdminTableColumn<AdminRow> = { key: "case", label: "Case", render: item => <CaseLink item={item} tab={resource === "customers" || resource === "cases" ? "overview" : resource} /> };
  const updated: AdminTableColumn<AdminRow> = { key: "updated", label: sort === "created" ? "Created" : "Last activity", render: item => <AdminRecordTime value={sort === "created" ? item.createdAt : item.updatedAt} /> };
  const inspect: AdminTableColumn<AdminRow> = { key: "inspect", label: "", render: item => {
    if (resource === "cases" && item.caseId) return <Link className="admin-row-link admin-inspect-link" to={adminCaseHref(item.caseId, "overview", origin)}>Open case<ArrowUpRight size={14} aria-hidden /></Link>;
    if (resource === "customers") return <Link className="admin-row-link admin-inspect-link" to={`/admin/customers/${encodeURIComponent(item.customerId ?? item.id)}`}>View customer<ArrowUpRight size={14} aria-hidden /></Link>;
    const expanded = expandedId === item.id;
    const Icon = expanded ? ChevronUp : ChevronDown;
    return <Button variant="ghost" size="sm" onClick={() => onToggle(item.id)} aria-expanded={expanded} aria-controls={`admin-record-${resource}-${item.id}`}>{expanded ? "Hide details" : "View details"}<Icon size={14} aria-hidden /></Button>;
  } };
  if (resource === "cases") return [identity("Customer"), { key: "vehicle", label: "Vehicle / case", render: item => <><p className="admin-primary-text">{item.summary ?? "Vehicle not yet provided"}</p><CaseLink item={item} returnTo={origin} /></> }, { key: "stage", label: "Current stage", render: item => <Status item={item} /> }, { key: "attention", label: "Attention", render: item => <Attention item={item} /> }, updated, inspect];
  if (resource === "customers") return [identity("Customer"), { key: "verification", label: "Account & verification", render: item => <><AdminBadge tone={item.verified ? "success" : "neutral"}>{item.verified === true ? "Verified email" : item.verified === false ? "Email unverified" : "Verification not recorded"}</AdminBadge><p className="admin-secondary-text">{item.identity === "guest" ? "Guest session" : "Registered account"}</p></> }, { key: "cases", label: "Total-loss cases", render: item => <span className="admin-case-count">{item.caseCount ?? "—"}<span>{item.caseCount === 0 ? "No linked cases" : item.caseCount === 1 ? "Linked case" : "Linked cases"}</span></span> }, { key: "followup", label: "Follow-up allowed", render: item => <Fact item={item} label="Follow-up allowed" /> }, updated, inspect];
  if (resource === "reports") return [identity("Report"), caseColumn, { key: "status", label: "Report status", render: item => <><Status item={item} />{item.attentionReasons.length ? <p className="admin-issue-text">Review required</p> : null}</> }, { key: "publication", label: "Publication / source", render: item => item.kind === "generated" ? <><p className="admin-primary-text">{factValue(item, "Published at") ? "Published" : factValue(item, "Published at") === null ? "Not published" : "Publication not recorded"}</p><p className="admin-secondary-text">{factValue(item, "Current version") === "true" ? "Current version" : factValue(item, "Superseded") === "true" ? "Superseded version" : "Version: " + (factValue(item, "Version") ?? "Not recorded")}</p></> : <><p className="admin-primary-text"><Fact item={item} label="Source" /></p><p className="admin-secondary-text"><Fact item={item} label="Extraction status" /></p></> }, updated, inspect];
  if (resource === "processing") return [identity("Processing job"), caseColumn, { key: "status", label: "Execution", render: item => <><Status item={item} /><p className="admin-secondary-text">{factValue(item, "Current") === "true" ? "Current job" : factValue(item, "Current") === "false" ? "Historical job" : humanizeAdminCode(item.kind)}</p></> }, { key: "attempts", label: "Attempts & retry", render: item => <><p className="admin-primary-text">Attempts: <Fact item={item} label="Attempts" /></p>{factValue(item, "Next attempt at") ? <p className="admin-secondary-text">Scheduled: <Fact item={item} label="Next attempt at" /></p> : <p className="admin-secondary-text">Retryable: <Fact item={item} label="Retryable" /></p>}{factValue(item, "Failure") ? <p className="admin-issue-text"><Fact item={item} label="Failure" /></p> : null}</> }, updated, inspect];
  if (resource === "payments") return [{ key: "order", label: "Order / case", render: item => <><Identity item={item} resource={resource} /><CaseLink item={item} tab="payments" /></> }, { key: "amount", label: "Amount / mode", render: item => <><p className="admin-amount"><Fact item={item} label="Amount" /></p><span className="admin-mode-label"><Fact item={item} label="Mode" /></span></> }, { key: "status", label: "Payment status", render: item => <><Status item={item} />{item.attentionReasons.length ? <Attention item={item} /> : null}</> }, { key: "access", label: "Customer access", render: item => <><p className="admin-primary-text"><Fact item={item} label="Access status" /></p><p className="admin-secondary-text"><Fact item={item} label="Access reason" /></p></> }, updated, inspect];
  return [{ key: "event", label: "Event", render: item => <><p className="admin-primary-text">{adminActivityTitle(item.title)}</p>{item.subtitle ? <p className="admin-secondary-text">{item.subtitle}</p> : null}</> }, caseColumn, { key: "actor", label: "Actor category", render: item => <AdminBadge>{humanizeAdminCode(factValue(item, "Actor category") ?? item.summary)}</AdminBadge> }, { key: "recorded", label: "Recorded", render: item => <AdminRecordTime value={item.createdAt} /> }, inspect];
}
