import { ArrowLeft, Download, FileText, RefreshCw } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
import { AdminRouteState } from "@/features/admin/diminished-value/admin-route-state";
import { useAdminDiminishedValueDependencies } from "@/features/admin/diminished-value/dependencies";
import {
  formatAdminAnswer,
  formatAdminContactMethod,
  formatAdminCurrency,
  formatAdminDate,
  formatAdminDateTime,
  formatAdminFileSize,
  formatAdminMileage,
  formatAdminRepairStatus,
} from "@/features/admin/diminished-value/format";
import {
  useStaffCaseQuery,
  useStaffDocumentsQuery,
} from "@/features/admin/diminished-value/queries";
import type { StaffDiminishedValueCase } from "@/features/admin/diminished-value/types";
import { useAuth } from "@/features/auth";
import type {
  DiminishedValueDocumentReadService,
  DiminishedValueStoredDocument,
} from "@/features/diminished-value/storage-service";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function AdminDiminishedValueCasePage() {
  const { caseId: routeCaseId = "" } = useParams();
  const validCaseId = UUID_PATTERN.test(routeCaseId)
    ? routeCaseId.toLowerCase()
    : "";
  const { auth } = useAuth();
  const dependencies = useAdminDiminishedValueDependencies();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const caseQuery = useStaffCaseQuery({
    caseId: validCaseId,
    service: dependencies?.caseService ?? null,
    userId,
  });
  const appraisalCase = caseQuery.data ?? null;
  const documentsQuery = useStaffDocumentsQuery({
    caseId: validCaseId,
    ownerUserId: appraisalCase?.ownerUserId ?? null,
    service: dependencies?.documentService ?? null,
    userId,
  });

  if (!validCaseId) return <UnavailableCaseState />;

  if (caseQuery.isPending) {
    return (
      <AdminRouteState
        kind="loading"
        eyebrow="Submitted request"
        heading="Loading case details…"
        description="Venfour is securely opening the submitted intake."
      />
    );
  }

  if (caseQuery.isError) {
    return (
      <AdminRouteState
        kind="error"
        eyebrow="Unable to load case"
        heading="We couldn’t open this submitted request."
        description="A temporary connection problem prevented Venfour from retrieving the case."
      >
        <Button variant="outline" onClick={() => void caseQuery.refetch()}>
          <RefreshCw className="size-4" aria-hidden />
          Try again
        </Button>
        <Button asChild variant="ghost">
          <Link to="/admin/diminished-value">Return to queue</Link>
        </Button>
      </AdminRouteState>
    );
  }

  if (!appraisalCase) return <UnavailableCaseState />;

  return (
    <article className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10 lg:py-12">
      <Link
        to="/admin/diminished-value"
        className="inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to submitted requests
      </Link>

      <header className="mt-5 border-b border-line pb-7">
        <p className="text-sm font-semibold tracking-[0.12em] text-brand uppercase">
          Read-only staff review
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-ink sm:text-4xl">
          Diminished-value request
        </h1>
        <p className="mt-3 font-mono text-sm break-all text-copy">
          {appraisalCase.caseId}
        </p>
      </header>

      <div className="mt-7 grid gap-6">
        <DetailSection title="Submission">
          <DetailField
            label="Case reference"
            value={appraisalCase.caseId}
            mono
          />
          <DetailField
            label="Submitted"
            value={formatAdminDateTime(appraisalCase.submittedAt)}
          />
        </DetailSection>

        <DetailSection title="Customer">
          <DetailField label="Name" value={appraisalCase.fullName} />
          <DetailField label="Email" value={appraisalCase.email} />
          <DetailField label="Phone" value={appraisalCase.phone} />
          <DetailField
            label="Preferred contact method"
            value={formatAdminContactMethod(
              appraisalCase.preferredContactMethod,
            )}
          />
        </DetailSection>

        <DetailSection title="Vehicle">
          <DetailField
            label="Identification provided"
            value={
              appraisalCase.vehicleEntryMethod === "vin"
                ? "VIN"
                : "Year, make, and model"
            }
          />
          <DetailField label="VIN" value={appraisalCase.vin} mono />
          <DetailField
            label="Year"
            value={appraisalCase.vehicleYear?.toString() ?? null}
          />
          <DetailField label="Make" value={appraisalCase.vehicleMake} />
          <DetailField label="Model" value={appraisalCase.vehicleModel} />
          <DetailField label="Trim" value={appraisalCase.vehicleTrim} />
          <DetailField
            label="Mileage at the accident"
            value={formatAdminMileage(appraisalCase.mileageAtAccident)}
          />
          <DetailField
            label="Current mileage"
            value={formatAdminMileage(appraisalCase.currentMileage)}
          />
        </DetailSection>

        <DetailSection title="Accident">
          <DetailField
            label="State where the accident occurred"
            value={appraisalCase.accidentState}
          />
          <DetailField
            label="Accident date"
            value={formatAdminDate(appraisalCase.accidentDate)}
          />
          <DetailField
            label="Was another party at fault?"
            value={formatAdminAnswer(appraisalCase.otherPartyAtFault)}
          />
          <DetailField
            label="At-fault party’s insurance company"
            value={appraisalCase.atFaultInsurer}
          />
        </DetailSection>

        <DetailSection title="Repairs and damage">
          <DetailField
            label="Repair status"
            value={formatAdminRepairStatus(appraisalCase.repairStatus)}
          />
          <DetailField
            label="Repair cost"
            value={formatAdminCurrency(appraisalCase.repairCost)}
          />
          <DetailField
            label="Repair facility"
            value={appraisalCase.repairFacility}
          />
          <DetailField
            label="Was there structural or frame damage?"
            value={formatAdminAnswer(appraisalCase.structuralDamage)}
          />
          <DetailField
            label="Did any airbags deploy?"
            value={formatAdminAnswer(appraisalCase.airbagDeployment)}
          />
          <DetailField
            label="Major repair information"
            value={appraisalCase.majorRepairDetails}
            wide
          />
        </DetailSection>

        <DetailSection title="Review preferences">
          <DetailField
            label="General availability"
            value={appraisalCase.availability}
            wide
          />
          <DetailField
            label="Anything else we should know?"
            value={appraisalCase.notes}
            wide
          />
        </DetailSection>

        <DocumentSection
          appraisalCase={appraisalCase}
          documents={documentsQuery.data ?? []}
          loading={documentsQuery.isPending}
          error={documentsQuery.isError}
          service={dependencies?.documentService ?? null}
          onRetry={() => void documentsQuery.refetch()}
        />
      </div>
    </article>
  );
}

function DetailSection({
  children,
  title,
}: {
  readonly children: React.ReactNode;
  readonly title: string;
}) {
  return (
    <section className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-xl font-semibold tracking-[-0.025em] text-ink">
        {title}
      </h2>
      <dl className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

function DetailField({
  label,
  mono = false,
  value,
  wide = false,
}: {
  readonly label: string;
  readonly mono?: boolean;
  readonly value: string | null;
  readonly wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-xs font-semibold tracking-[0.1em] text-copy uppercase">
        {label}
      </dt>
      <dd
        className={`mt-1 whitespace-pre-wrap text-sm leading-6 text-ink ${
          mono ? "font-mono break-all" : ""
        }`}
      >
        {value || "Not provided"}
      </dd>
    </div>
  );
}

function DocumentSection({
  appraisalCase,
  documents,
  error,
  loading,
  onRetry,
  service,
}: {
  readonly appraisalCase: StaffDiminishedValueCase;
  readonly documents: readonly DiminishedValueStoredDocument[];
  readonly error: boolean;
  readonly loading: boolean;
  readonly onRetry: () => void;
  readonly service: DiminishedValueDocumentReadService | null;
}) {
  const [pendingDocumentId, setPendingDocumentId] = useState<string | null>(
    null,
  );
  const [downloadErrors, setDownloadErrors] = useState<
    Readonly<Record<string, string>>
  >({});
  const mountedRef = useRef(true);
  const activeDownloadRef = useRef<AbortController | null>(null);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeDownloadRef.current?.abort();
      activeDownloadRef.current = null;
    };
  }, []);

  const downloadDocument = async (document: DiminishedValueStoredDocument) => {
    if (!service || pendingDocumentId) return;
    const controller = new AbortController();
    activeDownloadRef.current = controller;
    setPendingDocumentId(document.id);
    setDownloadErrors((current) => ({ ...current, [document.id]: "" }));
    try {
      const blob = await service.downloadDocument({
        caseId: appraisalCase.caseId,
        userId: appraisalCase.ownerUserId,
        document,
        signal: controller.signal,
      });
      if (!mountedRef.current || controller.signal.aborted) return;
      triggerDocumentDownload(blob, document.displayFilename);
    } catch {
      if (!mountedRef.current || controller.signal.aborted) return;
      setDownloadErrors((current) => ({
        ...current,
        [document.id]:
          "We couldn’t securely download this document. Try again.",
      }));
    } finally {
      if (activeDownloadRef.current === controller) {
        activeDownloadRef.current = null;
      }
      if (mountedRef.current) setPendingDocumentId(null);
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-xl font-semibold tracking-[-0.025em] text-ink">
        Supporting documents
      </h2>
      <p className="mt-2 text-sm leading-6 text-copy">
        Documents remain private and are downloaded through the authenticated
        staff session.
      </p>

      {loading ? (
        <p className="mt-5 text-sm text-copy" role="status" aria-live="polite">
          Loading supporting documents…
        </p>
      ) : error ? (
        <div
          className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4"
          role="alert"
        >
          <p className="text-sm text-red-900">
            We couldn’t load supporting documents.
          </p>
          <Button className="mt-3" variant="outline" onClick={onRetry}>
            <RefreshCw className="size-4" aria-hidden />
            Try again
          </Button>
        </div>
      ) : documents.length === 0 ? (
        <p className="mt-5 rounded-xl bg-surface p-4 text-sm text-copy">
          No supporting documents were submitted.
        </p>
      ) : (
        <ul className="mt-5 grid gap-3" aria-label="Supporting documents">
          {documents.map((document) => (
            <li
              key={document.id}
              className="rounded-xl border border-line bg-surface/55 p-4"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
                  <FileText className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold break-words text-ink">
                    {document.displayFilename}
                  </p>
                  <p className="mt-1 text-xs text-copy">
                    {document.extension.toUpperCase()} ·{" "}
                    {formatAdminFileSize(document.size)} · Attached{" "}
                    {formatAdminDateTime(document.createdAt)}
                  </p>
                </div>
                <Button
                  variant="outline"
                  disabled={pendingDocumentId !== null}
                  onClick={() => void downloadDocument(document)}
                >
                  <Download className="size-4" aria-hidden />
                  {pendingDocumentId === document.id
                    ? "Downloading…"
                    : "Download"}
                </Button>
              </div>
              {downloadErrors[document.id] ? (
                <p className="mt-3 text-sm text-red-700" role="alert">
                  {downloadErrors[document.id]}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function triggerDocumentDownload(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

function UnavailableCaseState() {
  return (
    <AdminRouteState
      kind="unavailable"
      eyebrow="Case unavailable"
      heading="We couldn’t find this submitted request."
      description="The case may not exist or may not be available in the submitted diminished-value queue."
    >
      <Button asChild variant="outline">
        <Link to="/admin/diminished-value">Return to queue</Link>
      </Button>
    </AdminRouteState>
  );
}
