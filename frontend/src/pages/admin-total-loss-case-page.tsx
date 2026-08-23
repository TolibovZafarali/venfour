import { AlertTriangle, ArrowLeft, FileText, RefreshCw } from "lucide-react";
import { Link, useParams } from "react-router";

import { Button } from "@/components/ui/button";
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
import { AdminRouteState } from "@/features/admin/diminished-value/admin-route-state";
import { useAuth } from "@/features/auth";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function AdminTotalLossCasePage() {
  const { caseId: routeCaseId = "" } = useParams();
  const validCaseId = UUID_PATTERN.test(routeCaseId)
    ? routeCaseId.toLowerCase()
    : "";
  const { auth } = useAuth();
  const dependencies = useAdminCaseOperationsDependencies();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const caseQuery = useStaffTotalLossCaseOperationQuery({
    caseId: validCaseId,
    service: dependencies?.caseService ?? null,
    userId,
  });

  if (!validCaseId) return <UnavailableCaseState />;

  if (caseQuery.isPending) {
    return (
      <AdminRouteState
        kind="loading"
        eyebrow="Total-loss case"
        heading="Loading case details…"
        description="Venfour is securely opening the operational case record."
      />
    );
  }

  if (caseQuery.isError) {
    return (
      <AdminRouteState
        kind="error"
        eyebrow="Unable to load case"
        heading="We couldn’t open this total-loss case."
        description="A temporary connection problem prevented Venfour from retrieving the case."
      >
        <Button variant="outline" onClick={() => void caseQuery.refetch()}>
          <RefreshCw className="size-4" aria-hidden />
          Try again
        </Button>
        <Button asChild variant="ghost">
          <Link to="/admin/cases">Return to cases</Link>
        </Button>
      </AdminRouteState>
    );
  }

  if (!caseQuery.data) return <UnavailableCaseState />;

  const appraisalCase = caseQuery.data;
  return (
    <article className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10 lg:py-12">
      <Link
        to="/admin/cases"
        className="inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-semibold text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back to customer cases
      </Link>

      <header className="mt-5 border-b border-line pb-7">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex min-h-7 items-center rounded-full border border-brand/20 bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand">
            {formatCaseOperationStage(appraisalCase.caseStage)}
          </span>
          {appraisalCase.needsAttention ? (
            <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-950">
              <AlertTriangle className="size-3.5" aria-hidden />
              Needs attention
            </span>
          ) : null}
        </div>
        <p className="mt-5 text-sm font-semibold tracking-[0.12em] text-brand uppercase">
          Read-only staff view
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-ink sm:text-4xl">
          Total-loss case #{formatCaseOperationReference(appraisalCase.caseId)}
        </h1>
        <p className="mt-3 font-mono text-sm break-all text-copy">
          {appraisalCase.caseId}
        </p>
      </header>

      {appraisalCase.needsAttention ? (
        <AttentionNotice appraisalCase={appraisalCase} />
      ) : null}

      <div className="mt-7 grid gap-6">
        <DetailSection title="Customer">
          <DetailField
            label="Confirmed full name"
            value={appraisalCase.customerFullName}
          />
          <DetailField
            label="Verified email"
            value={appraisalCase.verifiedEmail}
          />
          <DetailField
            label="Operational follow-up"
            value={formatOperationalFollowUp(
              appraisalCase.operationalFollowUpAllowed,
            )}
          />
          <DetailField
            label="Customer identifier"
            value={appraisalCase.ownerUserId}
            mono
          />
        </DetailSection>

        <DetailSection title="Case">
          <DetailField
            label="Case reference"
            value={appraisalCase.caseId}
            mono
          />
          <DetailField
            label="Current stage"
            value={formatCaseOperationStage(appraisalCase.caseStage)}
          />
          <DetailField
            label="Case status"
            value={formatCaseOperationStatus(appraisalCase.caseStatus)}
          />
          <DetailField
            label="Needs attention"
            value={appraisalCase.needsAttention ? "Yes" : "No"}
          />
          <DetailField
            label="Created"
            value={formatCaseOperationDateTime(appraisalCase.caseCreatedAt)}
          />
          <DetailField
            label="Updated"
            value={formatCaseOperationDateTime(appraisalCase.caseUpdatedAt)}
          />
          <DetailField
            label="Last activity"
            value={formatCaseOperationDateTime(appraisalCase.lastActivityAt)}
          />
        </DetailSection>

        <DetailSection title="Total-loss intake">
          <DetailField
            label="Intake method"
            value={
              appraisalCase.intakeMode === "report"
                ? "CCC report"
                : appraisalCase.intakeMode === "manual"
                  ? "Vehicle details"
                  : null
            }
          />
          <DetailField
            label="Vehicle"
            value={formatCaseOperationVehicle(
              appraisalCase.vehicleYear,
              appraisalCase.vehicleMake,
              appraisalCase.vehicleModel,
              appraisalCase.vehicleTrim,
            )}
          />
          <DetailField label="VIN" value={appraisalCase.vin} mono />
          <DetailField
            label="Mileage at loss"
            value={formatCaseOperationMileage(appraisalCase.mileageAtLoss)}
          />
          <DetailField
            label="Postal code"
            value={appraisalCase.postalCode}
          />
          <DetailField
            label="Date of loss"
            value={formatCaseOperationDate(appraisalCase.dateOfLoss)}
          />
          <DetailField
            label="Insurance company"
            value={appraisalCase.insurerName}
          />
          <DetailField
            label="Insurer vehicle valuation"
            value={formatCaseOperationCurrency(
              appraisalCase.insurerVehicleValuation,
            )}
          />
          <DetailField
            label="Intake completed"
            value={formatCaseOperationDateTime(
              appraisalCase.intakeCompletedAt,
            )}
          />
          <DetailField
            label="Intake record created"
            value={formatCaseOperationDateTime(appraisalCase.detailsCreatedAt)}
          />
          <DetailField
            label="Intake record updated"
            value={formatCaseOperationDateTime(appraisalCase.detailsUpdatedAt)}
          />
        </DetailSection>

        <ReportSection appraisalCase={appraisalCase} />

        <DetailSection title="Analysis activity">
          <DetailField
            label="Job status"
            value={formatCaseOperationAnalysisStatus(
              appraisalCase.analysisStatus,
            )}
          />
          <DetailField
            label="Attempts"
            value={appraisalCase.analysisAttemptCount?.toString() ?? null}
          />
          <DetailField
            label="Job identifier"
            value={appraisalCase.analysisJobId}
            mono
          />
          <DetailField
            label="Failure code"
            value={formatCaseOperationCode(
              appraisalCase.analysisFailureCode,
            )}
          />
          <DetailField
            label="Retryable"
            value={formatCaseOperationBoolean(
              appraisalCase.analysisRetryable,
            )}
          />
          <DetailField
            label="Processing lease expires"
            value={formatCaseOperationDateTime(
              appraisalCase.analysisProcessingExpiresAt,
            )}
          />
          <DetailField
            label="Job created"
            value={formatCaseOperationDateTime(
              appraisalCase.analysisJobCreatedAt,
            )}
          />
          <DetailField
            label="Job updated"
            value={formatCaseOperationDateTime(
              appraisalCase.analysisJobUpdatedAt,
            )}
          />
          <DetailField
            label="Job finished"
            value={formatCaseOperationDateTime(
              appraisalCase.analysisJobFinishedAt,
            )}
          />
        </DetailSection>

        <RunSummarySection appraisalCase={appraisalCase} />
      </div>
    </article>
  );
}

function AttentionNotice({
  appraisalCase,
}: {
  readonly appraisalCase: StaffTotalLossCaseOperation;
}) {
  return (
    <section
      className="mt-7 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950 sm:p-6"
      aria-labelledby="attention-heading"
    >
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div>
          <h2 id="attention-heading" className="font-semibold">
            This case needs staff attention.
          </h2>
          <p className="mt-1 text-sm leading-6">
            {appraisalCase.analysisFailureCode
              ? `The latest analysis ended with ${formatCaseOperationCode(
                  appraisalCase.analysisFailureCode,
                )}. Review the operational details below.`
              : "The authoritative case-stage projection found a condition that should be reviewed."}
          </p>
        </div>
      </div>
    </section>
  );
}

function ReportSection({
  appraisalCase,
}: {
  readonly appraisalCase: StaffTotalLossCaseOperation;
}) {
  return (
    <section className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
          <FileText className="size-5" aria-hidden />
        </span>
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.025em] text-ink">
            CCC report
          </h2>
          <p className="mt-1 text-sm leading-6 text-copy">
            Report metadata only. The private source PDF is not available from
            this workspace.
          </p>
        </div>
      </div>
      <dl className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">
        <DetailField
          label="Display filename"
          value={appraisalCase.reportOriginalFilename}
        />
        <DetailField
          label="Uploaded"
          value={formatCaseOperationDateTime(appraisalCase.reportUploadedAt)}
        />
      </dl>
    </section>
  );
}

function RunSummarySection({
  appraisalCase,
}: {
  readonly appraisalCase: StaffTotalLossCaseOperation;
}) {
  if (!appraisalCase.analysisRunId) {
    return (
      <section className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-xl font-semibold tracking-[-0.025em] text-ink">
          Completed run summary
        </h2>
        <p className="mt-3 rounded-xl bg-surface p-4 text-sm text-copy">
          No completed analysis run is available for this case.
        </p>
      </section>
    );
  }

  return (
    <DetailSection title="Completed run summary">
      <DetailField
        label="Run identifier"
        value={appraisalCase.analysisRunId}
        mono
      />
      <DetailField
        label="Run created"
        value={formatCaseOperationDateTime(
          appraisalCase.analysisRunCreatedAt,
        )}
      />
      <DetailField
        label="Classification"
        value={formatCaseOperationCode(
          appraisalCase.analysisClassification,
        )}
      />
      <DetailField
        label="Evidence strength"
        value={formatCaseOperationCode(
          appraisalCase.analysisEvidenceStrength,
        )}
      />
      <DetailField
        label="Evidence basis"
        value={formatCaseOperationCode(appraisalCase.analysisEvidenceBasis)}
        wide
      />
      <DetailField
        label="Run schema version"
        value={appraisalCase.analysisRunSchemaVersion}
        mono
      />
      <DetailField
        label="Analysis version"
        value={appraisalCase.analysisVersion}
        mono
      />
      <DetailField
        label="Discrepancy analysis version"
        value={appraisalCase.discrepancyAnalysisVersion}
        mono
      />
      <DetailField
        label="Comparable scoring version"
        value={appraisalCase.comparableScoringVersion}
        mono
      />
    </DetailSection>
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

function UnavailableCaseState() {
  return (
    <AdminRouteState
      kind="unavailable"
      eyebrow="Case unavailable"
      heading="We couldn’t find this case."
      description="The address may be incorrect, or this case may not be available to your staff account."
    >
      <Button asChild variant="outline">
        <Link to="/admin/cases">Return to customer cases</Link>
      </Button>
    </AdminRouteState>
  );
}
