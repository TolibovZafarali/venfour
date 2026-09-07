import { ArrowLeft, ArrowRight, Inbox, RefreshCw, Search } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";

export function AdminPageHeader({ title, description, eyebrow = "Staff workspace", actions, refreshing = false, onRefresh }: {
  readonly title: string;
  readonly description: string;
  readonly eyebrow?: string;
  readonly actions?: ReactNode;
  readonly refreshing?: boolean;
  readonly onRefresh?: () => void;
}) {
  return <header className="admin-page-header">
    <div><p className="admin-eyebrow">{eyebrow}</p><h1>{title}</h1><p className="admin-page-description">{description}</p></div>
    <div className="admin-page-actions">{actions}{onRefresh ? <Button variant="outline" onClick={onRefresh} disabled={refreshing}><RefreshCw className={refreshing ? "size-4 animate-spin motion-reduce:animate-none" : "size-4"} aria-hidden />Refresh</Button> : null}</div>
  </header>;
}

export function AdminLoadingState({ label = "Loading records…" }: { readonly label?: string }) {
  return <div className="admin-skeleton" role="status" aria-busy="true"><span className="sr-only">{label}</span>{[0, 1, 2, 3, 4].map(index => <div key={index} />)}</div>;
}

export function AdminEmptyState({ title, description, action }: { readonly title: string; readonly description: string; readonly action?: ReactNode }) {
  return <div className="admin-empty-state"><Inbox className="size-7" aria-hidden /><h2>{title}</h2><p>{description}</p>{action}</div>;
}

export function AdminErrorState({ onRetry, description = "The records could not be loaded. Try refreshing the page." }: { readonly onRetry?: () => void; readonly description?: string }) {
  return <div className="admin-empty-state" role="alert"><h2>Unable to load records</h2><p>{description}</p>{onRetry ? <Button variant="outline" onClick={onRetry}><RefreshCw className="size-4" aria-hidden />Try again</Button> : null}</div>;
}

export function AdminRefreshNotice() {
  return <div className="admin-notice" role="status"><p>The latest refresh failed. These previously loaded records may be out of date.</p></div>;
}

export function AdminBadge({ children, tone = "neutral" }: { readonly children: ReactNode; readonly tone?: "neutral" | "success" | "warning" | "danger" }) {
  return <span className="admin-badge" data-tone={tone}>{children}</span>;
}

export function AdminSearch({ value, onChange, placeholder = "Search records", label = "Search records" }: { readonly value: string; readonly onChange: (value: string) => void; readonly placeholder?: string; readonly label?: string }) {
  return <label className="admin-search"><Search className="size-4" aria-hidden /><span className="sr-only">{label}</span><input type="search" maxLength={200} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} /></label>;
}

export function AdminSelect({ label, value, onChange, options }: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void; readonly options: readonly { readonly value: string; readonly label: string }[] }) {
  return <label className="admin-select"><span className="sr-only">{label}</span><select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

export interface AdminTableColumn<T> {
  readonly label: string;
  readonly key: string;
  readonly render: (item: T) => ReactNode;
}

export function AdminTable<T>({ label, columns, items, itemKey, expandedItemKey, renderExpanded }: { readonly label: string; readonly columns: readonly AdminTableColumn<T>[]; readonly items: readonly T[]; readonly itemKey: (item: T) => string; readonly expandedItemKey?: string | null; readonly renderExpanded?: (item: T) => ReactNode }) {
  return <div className="admin-table-wrap"><table className="admin-table"><caption className="sr-only">{label}</caption><thead><tr>{columns.map(column => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead><tbody>{items.map(item => <Fragment key={itemKey(item)}><tr>{columns.map(column => <td key={column.key} data-label={column.label}>{column.render(item)}</td>)}</tr>{expandedItemKey === itemKey(item) && renderExpanded ? <tr className="admin-expanded-row"><td colSpan={columns.length} className="admin-expanded-cell">{renderExpanded(item)}</td></tr> : null}</Fragment>)}</tbody></table></div>;
}

export function AdminPagination({ page, pageSize, total, onPageChange, fetching = false }: { readonly page: number; readonly pageSize: number; readonly total: number; readonly onPageChange: (page: number) => void; readonly fetching?: boolean }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return <nav className="admin-pagination" aria-label="Record pagination"><p>{total === 0 ? "0 records" : `${Math.min((page - 1) * pageSize + 1, total)}–${Math.min(page * pageSize, total)} of ${total}`}</p><div><Button variant="outline" disabled={page <= 1 || fetching} onClick={() => onPageChange(page - 1)} aria-label="Previous page"><ArrowLeft className="size-4" aria-hidden />Previous</Button><span>Page {page} of {pageCount}</span><Button variant="outline" disabled={page >= pageCount || fetching} onClick={() => onPageChange(page + 1)} aria-label="Next page">Next<ArrowRight className="size-4" aria-hidden /></Button></div></nav>;
}

export function AdminPanel({ title, children, description, action }: { readonly title: string; readonly children: ReactNode; readonly description?: string; readonly action?: ReactNode }) {
  return <section className="admin-panel"><header className="admin-panel-header"><div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>{action}</header>{children}</section>;
}

export function AdminDetailField({ label, value, mono = false }: { readonly label: string; readonly value: ReactNode; readonly mono?: boolean }) {
  return <div className="admin-detail-field"><dt>{label}</dt><dd className={mono ? "font-mono break-all" : undefined}>{value === null || value === undefined || value === "" ? "Not provided" : value}</dd></div>;
}

export function AdminBackLink({ to, children }: { readonly to: string; readonly children: ReactNode }) {
  return <Link to={to} className="admin-back-link"><ArrowLeft className="size-4" aria-hidden />{children}</Link>;
}
