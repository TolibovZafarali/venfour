import { ClipboardList, RefreshCw } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { useAdminDiminishedValueDependencies } from "@/features/admin/diminished-value/dependencies";
import {
  formatAdminContactMethod,
  formatAdminDate,
  formatAdminDateTime,
  formatAdminVehicle,
} from "@/features/admin/diminished-value/format";
import { useStaffQueueQuery } from "@/features/admin/diminished-value/queries";
import type { StaffDiminishedValueQueueItem } from "@/features/admin/diminished-value/types";
import { useAuth } from "@/features/auth";

export function AdminDiminishedValueQueuePage() {
  const { auth } = useAuth();
  const dependencies = useAdminDiminishedValueDependencies();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const queueQuery = useStaffQueueQuery({
    service: dependencies?.caseService ?? null,
    userId,
  });

  return (
    <section className="mx-auto w-full max-w-[90rem] px-5 py-8 sm:px-8 sm:py-10 lg:px-10 lg:py-12">
      <div className="flex flex-col gap-4 border-b border-line pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold tracking-[0.12em] text-brand uppercase">
            Staff review
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-ink sm:text-4xl">
            Submitted diminished-value requests
          </h1>
          <p className="mt-3 max-w-3xl leading-7 text-copy">
            Review customer-submitted intake information and supporting
            documents. This workspace is read-only.
          </p>
        </div>
        {!queueQuery.isPending ? (
          <Button
            variant="outline"
            disabled={queueQuery.isFetching}
            onClick={() => void queueQuery.refetch()}
          >
            <RefreshCw
              className={
                queueQuery.isFetching
                  ? "size-4 animate-spin motion-reduce:animate-none"
                  : "size-4"
              }
              aria-hidden
            />
            Refresh
          </Button>
        ) : null}
      </div>

      {queueQuery.isPending ? (
        <QueueLoadingState />
      ) : queueQuery.isError ? (
        <QueueErrorState onRetry={() => void queueQuery.refetch()} />
      ) : queueQuery.data.length === 0 ? (
        <QueueEmptyState />
      ) : (
        <ol className="mt-7 grid gap-4" aria-label="Submitted requests">
          {queueQuery.data.map((item) => (
            <QueueCard key={item.caseId} item={item} />
          ))}
        </ol>
      )}
    </section>
  );
}

function QueueCard({ item }: { readonly item: StaffDiminishedValueQueueItem }) {
  return (
    <li className="rounded-2xl border border-line bg-white p-5 shadow-sm sm:p-6">
      <div className="grid gap-5 lg:grid-cols-[minmax(12rem,1.1fr)_minmax(13rem,1.2fr)_minmax(12rem,1fr)_minmax(10rem,0.8fr)_auto] lg:items-center">
        <div>
          <p className="text-xs font-semibold tracking-[0.1em] text-copy uppercase">
            Submitted
          </p>
          <p className="mt-1 text-sm font-semibold text-ink">
            {formatAdminDateTime(item.submittedAt)}
          </p>
          <p className="mt-2 font-mono text-xs break-all text-copy">
            {item.caseId}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold tracking-[0.1em] text-copy uppercase">
            Customer
          </p>
          <p className="mt-1 font-semibold text-ink">
            {item.fullName || "Name not provided"}
          </p>
          <p className="mt-1 text-sm break-all text-copy">
            {item.email || "Email not provided"}
          </p>
          <p className="mt-0.5 text-sm text-copy">
            {item.phone || "Phone not provided"} ·{" "}
            {formatAdminContactMethod(item.preferredContactMethod)}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold tracking-[0.1em] text-copy uppercase">
            Vehicle
          </p>
          <p className="mt-1 font-semibold text-ink">
            {formatAdminVehicle(
              item.vehicleYear,
              item.vehicleMake,
              item.vehicleModel,
            )}
          </p>
          <p className="mt-1 text-sm text-copy">
            Accident: {formatAdminDate(item.accidentDate)}
          </p>
          <p className="mt-0.5 text-sm text-copy">
            At-fault insurer: {item.atFaultInsurer || "Not provided"}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold tracking-[0.1em] text-copy uppercase">
            Documents
          </p>
          <p className="mt-1 font-semibold text-ink">
            {item.documentCount} supporting{" "}
            {item.documentCount === 1 ? "document" : "documents"}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link
            to={`/admin/diminished-value/${encodeURIComponent(item.caseId)}`}
          >
            Open case
          </Link>
        </Button>
      </div>
    </li>
  );
}

function QueueLoadingState() {
  return (
    <div
      className="mt-7 grid animate-pulse gap-4 motion-reduce:animate-none"
      aria-label="Loading submitted requests"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">Loading submitted requests…</span>
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="h-40 rounded-2xl border border-line bg-white sm:h-32"
        />
      ))}
    </div>
  );
}

function QueueErrorState({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <div
      className="mt-7 rounded-2xl border border-red-200 bg-red-50 p-6"
      role="alert"
    >
      <h2 className="text-lg font-semibold text-red-950">
        We couldn’t load submitted requests.
      </h2>
      <p className="mt-2 text-sm leading-6 text-red-900">
        A temporary connection problem interrupted the staff queue. No case data
        was changed.
      </p>
      <Button className="mt-5" variant="outline" onClick={onRetry}>
        <RefreshCw className="size-4" aria-hidden />
        Try again
      </Button>
    </div>
  );
}

function QueueEmptyState() {
  return (
    <div className="mt-7 rounded-2xl border border-line bg-white p-8 text-center sm:p-12">
      <ClipboardList className="mx-auto size-10 text-copy" aria-hidden />
      <h2 className="mt-4 text-xl font-semibold text-ink">
        No submitted requests
      </h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-copy">
        Submitted diminished-value requests will appear here. Customer drafts
        are not included.
      </p>
    </div>
  );
}
