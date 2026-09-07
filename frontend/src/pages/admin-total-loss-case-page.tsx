import { AlertTriangle } from "lucide-react";
import { Tabs } from "radix-ui";
import type { ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";

import { useAdminCaseOperationsDependencies } from "@/features/admin/case-operations/dependencies";
import {
  formatCaseOperationAnalysisStatus,
  formatCaseOperationBoolean,
  formatCaseOperationCode,
  formatCaseOperationCurrency,
  formatCaseOperationDate,
  formatCaseOperationDateTime,
  formatCaseOperationMileage,
  formatCaseOperationReference,
  formatCaseOperationStage,
  formatCaseOperationStatus,
  formatCaseOperationVehicle,
  formatOperationalFollowUp,
} from "@/features/admin/case-operations/format";
import { useStaffTotalLossCaseOperationQuery } from "@/features/admin/case-operations/queries";
import type { StaffTotalLossCaseOperation } from "@/features/admin/case-operations/types";
import { AdminCollection, RecordFacts } from "@/features/admin/operations/collection";
import { AdminBackLink, AdminBadge, AdminDetailField, AdminEmptyState, AdminErrorState, AdminLoadingState, AdminRefreshNotice, AdminPageHeader, AdminPanel } from "@/features/admin/operations/page-ui";
import { safeAdminReturnTo, adminStatusTone, humanizeAdminCode } from "@/features/admin/operations/ui-format";
import { useAdminCase } from "@/features/admin/operations/queries";
import { useAuth } from "@/features/auth";
import { paymentFilters, processingFilters, reportFilters, activityFilters } from "@/features/admin/operations/page-options";

const tabs = [
  { value: "overview", label: "Overview" },
  { value: "intake", label: "Vehicle & intake" },
  { value: "reports", label: "Reports" },
  { value: "processing", label: "Processing" },
  { value: "payments", label: "Payments" },
  { value: "activity", label: "Activity" },
] as const;

export function AdminTotalLossCasePage() {
  const { caseId: routeCaseId = "" } = useParams();
  const caseId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(routeCaseId) ? routeCaseId.toLowerCase() : "";
  const [params, setParams] = useSearchParams();
  const tab = tabs.find(item => item.value === params.get("tab"))?.value ?? "overview";
  const returnTo = safeAdminReturnTo(params.get("returnTo"));
  const { auth } = useAuth();
  const dependencies = useAdminCaseOperationsDependencies();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const query = useStaffTotalLossCaseOperationQuery({ caseId, service: dependencies?.caseService ?? null, userId });
  const operation = useAdminCase(caseId);
  const selectTab = (value: string) => setParams(previous => {
    const next = new URLSearchParams(previous);
    for (const key of ["q", "page", "sort", "status", "kind", "identity", "verified", "hasCases", "attention", "view", "active", "customerId", "caseId"]) next.delete(key);
    if (value === "overview") next.delete("tab"); else next.set("tab", value);
    return next;
  });

  if (!caseId) return <UnavailableCase returnTo={returnTo} />;
  if (query.isPending) return <section className="admin-page"><AdminBackLink to={returnTo}>Back to cases</AdminBackLink><AdminLoadingState label="Loading case details…" /></section>;
  if (query.isError && !query.data) return <section className="admin-page"><AdminBackLink to={returnTo}>Back to cases</AdminBackLink><AdminErrorState description="This case could not be loaded. Try refreshing its records." onRetry={() => void query.refetch()} /></section>;
  if (!query.data) return <UnavailableCase returnTo={returnTo} />;
  const item = query.data;
  const name = item.contactFullName ?? item.customerFullName;
  const vehicle = formatCaseOperationVehicle(item.vehicleYear, item.vehicleMake, item.vehicleModel, item.vehicleTrim);
  const status = operation.data?.status ?? (dependencies?.operationsService ? operation.isPending ? "Current stage loading…" : "Current stage unavailable" : item.caseStage);
  const attentionReasons = operation.data?.attentionReasons ?? (dependencies?.operationsService ? [] : item.needsAttention ? [item.analysisFailureCode ? formatCaseOperationCode(item.analysisFailureCode) : "This case has a recorded condition that needs staff attention."] : []);
  return <article className="admin-page admin-case-page">
    <AdminBackLink to={returnTo}>Back to cases</AdminBackLink>
    {query.isError || (operation.isError && operation.data) ? <AdminRefreshNotice /> : null}
    <AdminPageHeader title={`Total-loss case #${formatCaseOperationReference(item.caseId)}`} description={[name, vehicle === "Not provided" ? null : vehicle].filter(Boolean).join(" · ") || "Customer and case details"} eyebrow="Case record" refreshing={query.isFetching || operation.isFetching} onRefresh={() => { void query.refetch(); if (dependencies?.operationsService) void operation.refetch(); }} actions={<AdminBadge tone={adminStatusTone(status)}>{humanizeAdminCode(status)}</AdminBadge>} />
    <div className="admin-case-summary"><span>Read-only staff view</span><span>{operation.data ? `Last activity ${formatCaseOperationDateTime(operation.data.updatedAt)}` : "Initial record activity " + formatCaseOperationDateTime(item.lastActivityAt)}</span><Link to={`/admin/customers/${encodeURIComponent(item.ownerUserId)}`} className="admin-row-link">View customer ↗</Link></div>
    {attentionReasons.length ? <div className="admin-notice"><AlertTriangle className="size-5 shrink-0" aria-hidden /><div><strong>This case needs staff attention.</strong>{attentionReasons.map(reason => <div key={reason}><p>{humanizeAdminCode(reason)}</p><button type="button" className="admin-row-link" onClick={() => selectTab(attentionDestination(reason))}>Inspect {attentionDestination(reason)} ↗</button></div>)}</div></div> : null}
    <Tabs.Root value={tab} onValueChange={selectTab} activationMode="manual"><Tabs.List className="admin-tabs" aria-label="Case sections">{tabs.map(item => <Tabs.Trigger key={item.value} value={item.value}>{item.label}</Tabs.Trigger>)}</Tabs.List>
      <Tabs.Content value="overview" className="admin-tab-panel">
        {dependencies?.operationsService ? operation.isPending ? <AdminLoadingState label="Loading current case journey…" /> : operation.isError && !operation.data ? <AdminErrorState description="The current journey could not be loaded. The original case record remains available below." onRetry={() => void operation.refetch()} /> : operation.data ? <AdminPanel title="Current journey"><RecordFacts item={operation.data} /></AdminPanel> : null : null}
        <OverviewSections item={item} />
      </Tabs.Content>
      <Tabs.Content value="intake" className="admin-tab-panel"><IntakeSection item={item} /></Tabs.Content>
      <Tabs.Content value="reports" className="admin-tab-panel"><SourceReportSection item={item} /><AdminCollection resource="reports" title="Case reports" description="Source and generated report metadata, including version and publication status." filters={reportFilters} fixedFilters={{ caseId }} embedded /></Tabs.Content>
      <Tabs.Content value="processing" className="admin-tab-panel"><AdminCollection resource="processing" title="Case processing" description="Recorded processing across free valuation, paid review, and insurer responses." filters={processingFilters} fixedFilters={{ caseId }} embedded /><AnalysisSections item={item} /></Tabs.Content>
      <Tabs.Content value="payments" className="admin-tab-panel"><AdminCollection resource="payments" title="Case payments" description="Recorded orders, checkout attempts, refunds, and entitlement status for this case." filters={paymentFilters} fixedFilters={{ caseId }} embedded /></Tabs.Content>
      <Tabs.Content value="activity" className="admin-tab-panel"><AdminCollection resource="activity" title="Case activity" description="Recorded workflow events after the customer continued the review. Initial intake dates are available under Overview and Vehicle & intake." filters={activityFilters} fixedFilters={{ caseId }} embedded /></Tabs.Content>
    </Tabs.Root>
  </article>;
}

type Field = readonly [label: string, value: ReactNode, mono?: boolean];
function Fields({ values }: { readonly values: readonly Field[] }) { return <dl className="admin-detail-grid">{values.map(([label, value, mono]) => <AdminDetailField key={label} label={label} value={value} mono={mono} />)}</dl>; }
function TechnicalDetails({ values }: { readonly values: readonly Field[] }) { return <details className="admin-technical-details"><summary>Technical details</summary><Fields values={values} /></details>; }

function OverviewSections({ item }: { readonly item: StaffTotalLossCaseOperation }) {
  return <>
    <AdminPanel title="Customer"><Fields values={[
      ["Customer name", item.customerFullName],
      ["Entered contact name", item.contactFullName],
      ["Entered contact email", item.contactEmail],
      ["Verified email", item.verifiedEmail],
      ["Contact email state", item.contactEmailVerified ? "Verified" : item.contactEmail ? "Entered — not verified" : null],
      ["Access state", item.ownerIsAnonymous ? "Guest session — access unclaimed" : item.identityClaimedAt ? "Access claimed" : "Account owner"],
      ["Access claimed", formatCaseOperationDateTime(item.identityClaimedAt)],
      ["Operational follow-up", formatOperationalFollowUp(item.operationalFollowUpAllowed)],
    ]} /><TechnicalDetails values={[["Customer identifier", item.ownerUserId, true]]} /></AdminPanel>
    <AdminPanel title="Case"><Fields values={[
      ["Initial review stage", formatCaseOperationStage(item.caseStage)],
      ["Case status", formatCaseOperationStatus(item.caseStatus)],
      ["Initial review needs attention", item.needsAttention ? "Yes" : "No"],
      ["Created", formatCaseOperationDateTime(item.caseCreatedAt)],
      ["Updated", formatCaseOperationDateTime(item.caseUpdatedAt)],
      ["Last activity", formatCaseOperationDateTime(item.lastActivityAt)],
    ]} /><TechnicalDetails values={[["Case reference", item.caseId, true]]} /></AdminPanel>
  </>;
}

function IntakeSection({ item }: { readonly item: StaffTotalLossCaseOperation }) {
  return <AdminPanel title="Total-loss intake"><Fields values={[
    ["Intake method", item.intakeMode === "report" ? "Valuation report" : item.intakeMode === "manual" ? "Vehicle details" : null],
    ["Vehicle", formatCaseOperationVehicle(item.vehicleYear, item.vehicleMake, item.vehicleModel, item.vehicleTrim)],
    ["VIN", item.vin, true],
    ["Mileage at loss", formatCaseOperationMileage(item.mileageAtLoss)],
    ["Postal code", item.postalCode],
    ["Date of loss", formatCaseOperationDate(item.dateOfLoss)],
    ["Insurance company", item.insurerName],
    ["Insurer vehicle valuation", formatCaseOperationCurrency(item.insurerVehicleValuation)],
    ["Vehicle condition", item.vehicleCondition],
    ["Options and packages", item.vehicleOptionsPackages],
    ["Intake completed", formatCaseOperationDateTime(item.intakeCompletedAt)],
  ]} /><TechnicalDetails values={[
    ["Confirmed input revision", item.analysisInputRevision?.toString() ?? null],
    ["Confirmed input identifier", item.analysisInputId, true],
    ["Intake record created", formatCaseOperationDateTime(item.detailsCreatedAt)],
    ["Intake record updated", formatCaseOperationDateTime(item.detailsUpdatedAt)],
  ]} /></AdminPanel>;
}

function SourceReportSection({ item }: { readonly item: StaffTotalLossCaseOperation }) {
  return <AdminPanel title="Valuation report" description="Report metadata only. The private source PDF is not available from this workspace."><Fields values={[
    ["Display filename", item.reportOriginalFilename],
    ["Uploaded", formatCaseOperationDateTime(item.reportUploadedAt)],
    ["Detected provider", item.reportProviderName],
    ["Extraction status", item.reportExtractionStatus],
    ["Extraction confidence", item.reportExtractionConfidence === null ? null : `${Math.round(item.reportExtractionConfidence * 100)}%`],
    ["Extracted", formatCaseOperationDateTime(item.reportExtractedAt)],
    ["Customer facts confirmed", formatCaseOperationDateTime(item.reportFactsConfirmedAt)],
  ]} /><TechnicalDetails values={[["Storage namespace", item.reportStorageOwnerId, true], ["Private object path", item.reportStorageObjectPath, true]]} /></AdminPanel>;
}

function AnalysisSections({ item }: { readonly item: StaffTotalLossCaseOperation }) {
  return <><AdminPanel title="Analysis activity" description="The original valuation analysis record, separate from paid review and insurer-response processing."><Fields values={[
    ["Job status", formatCaseOperationAnalysisStatus(item.analysisStatus)],
    ["Attempts", item.analysisAttemptCount?.toString() ?? null],
    ["Failure code", formatCaseOperationCode(item.analysisFailureCode)],
    ["Retryable", formatCaseOperationBoolean(item.analysisRetryable)],
    ["Processing lease expires", formatCaseOperationDateTime(item.analysisProcessingExpiresAt)],
    ["Job finished", formatCaseOperationDateTime(item.analysisJobFinishedAt)],
  ]} /><TechnicalDetails values={[
    ["Job identifier", item.analysisJobId, true],
    ["Job created", formatCaseOperationDateTime(item.analysisJobCreatedAt)],
    ["Job updated", formatCaseOperationDateTime(item.analysisJobUpdatedAt)],
  ]} /></AdminPanel>
  <AdminPanel title="Completed run summary">{item.analysisRunId ? <><Fields values={[
    ["Run created", formatCaseOperationDateTime(item.analysisRunCreatedAt)],
    ["Classification", formatCaseOperationCode(item.analysisClassification)],
    ["Evidence strength", formatCaseOperationCode(item.analysisEvidenceStrength)],
    ["Evidence basis", formatCaseOperationCode(item.analysisEvidenceBasis)],
  ]} /><TechnicalDetails values={[
    ["Run identifier", item.analysisRunId, true],
    ["Run schema version", item.analysisRunSchemaVersion, true],
    ["Analysis version", item.analysisVersion, true],
    ["Discrepancy analysis version", item.discrepancyAnalysisVersion, true],
    ["Comparable scoring version", item.comparableScoringVersion, true],
  ]} /></> : <p className="admin-secondary-text">No completed analysis run is available for this case.</p>}</AdminPanel></>;
}

function UnavailableCase({ returnTo }: { readonly returnTo: string }) { return <section className="admin-page"><AdminBackLink to={returnTo}>Back to cases</AdminBackLink><AdminEmptyState title="We couldn’t find this case." description="The address may be incorrect, or this case may not be available to your staff account." /></section>; }

function attentionDestination(reason: string): "payments" | "reports" | "processing" {
  if (/refund|payment|dispute|entitlement/iu.test(reason)) return "payments";
  if (/report/iu.test(reason)) return "reports";
  return "processing";
}
