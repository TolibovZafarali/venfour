import {
  AlertCircle,
  ArrowRight,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import {
  isPermanentAuthState,
  useAuth,
  useSignInDialog,
} from "@/features/auth";
import { AppraisalCaseCard } from "@/features/cases/appraisal-case-card";
import {
  AppraisalCasesEmptyState,
  AppraisalCasesErrorState,
  AppraisalCasesLoadingState,
} from "@/features/cases/appraisal-case-list-states";
import { useAppraisalCasesQuery } from "@/features/cases/queries";
import { useAppraisalCaseService } from "@/features/cases/service-context";
import { useNewTotalLossAppraisalHref } from "@/features/total-loss/new-appraisal";

const appraisalsPath = "/appraisals";

interface MessageCardProps {
  readonly children?: ReactNode;
  readonly description: string;
  readonly heading: string;
  readonly kind?: "error" | "loading" | "secure";
}

function MessageCard({
  children,
  description,
  heading,
  kind = "secure",
}: MessageCardProps) {
  const Icon =
    kind === "loading"
      ? LoaderCircle
      : kind === "error"
        ? AlertCircle
        : ShieldCheck;

  return (
    <section className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center px-5 py-16 sm:px-8 sm:py-24">
      <div
        className="w-full rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8"
        role={kind === "error" ? "alert" : undefined}
        aria-live={kind === "loading" ? "polite" : undefined}
        aria-busy={kind === "loading" ? true : undefined}
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">
          <Icon
            className={
              kind === "loading"
                ? "size-6 animate-spin motion-reduce:animate-none"
                : "size-6"
            }
            aria-hidden
          />
        </span>
        <p className="mt-6 text-sm font-semibold tracking-[0.12em] text-brand uppercase">
          Secure appraisals
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-ink sm:text-4xl">
          {heading}
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-copy">
          {description}
        </p>
        {children ? (
          <div className="mt-7 flex flex-wrap gap-3">{children}</div>
        ) : null}
      </div>
    </section>
  );
}

function AppraisalsHeader() {
  const newAppraisalHref = useNewTotalLossAppraisalHref();

  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold tracking-[0.12em] text-brand uppercase">
          Saved vehicle reviews
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-ink sm:text-5xl">
          My appraisals
        </h1>
        <p className="mt-4 text-base leading-7 text-copy sm:text-lg">
          Continue a saved request, follow a value check, or view your completed
          case history.
        </p>
      </div>
      <Button asChild className="shrink-0 self-start sm:self-auto">
        <Link to={newAppraisalHref}>
          Start a new appraisal
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </Button>
    </div>
  );
}

function AuthenticatedAppraisalsPage({
  service,
  userId,
}: {
  readonly service: NonNullable<ReturnType<typeof useAppraisalCaseService>>;
  readonly userId: string;
}) {
  const appraisalsQuery = useAppraisalCasesQuery({ service, userId });
  const cases = appraisalsQuery.data ?? [];
  const responseOutsideOwnerScope = cases.some(
    (appraisalCase) => appraisalCase.userId !== userId,
  );

  return (
    <section className="w-full bg-transparent">
      <div className="mx-auto w-full max-w-7xl px-5 py-12 sm:px-8 sm:py-16 lg:px-10 lg:py-20">
        <AppraisalsHeader />

        {appraisalsQuery.isPending ? (
          <AppraisalCasesLoadingState />
        ) : appraisalsQuery.isError || responseOutsideOwnerScope ? (
          <AppraisalCasesErrorState
            heading="We couldn’t load your appraisals."
            description="Venfour could not verify the saved appraisal list for this account. No appraisal information has been changed."
            onRetry={
              responseOutsideOwnerScope
                ? undefined
                : () => void appraisalsQuery.refetch()
            }
          />
        ) : cases.length === 0 ? (
          <AppraisalCasesEmptyState
            description="When you save a vehicle review or request, it will appear here for this signed-in account."
          />
        ) : (
          <div className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {cases.map((appraisalCase) => (
              <AppraisalCaseCard
                key={appraisalCase.id}
                appraisalCase={appraisalCase}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function AppraisalsPage() {
  const { auth } = useAuth();
  const { openSignIn } = useSignInDialog();
  const service = useAppraisalCaseService();

  if (auth.status === "loading") {
    return (
      <MessageCard
        kind="loading"
        heading="Checking your sign-in…"
        description="Venfour is confirming your account before loading saved appraisals."
      />
    );
  }

  if (auth.status === "unavailable") {
    return (
      <MessageCard
        kind="error"
        heading="We can’t securely open your appraisals right now."
        description={auth.reason}
      >
        <Button asChild variant="outline">
          <Link to="/contact">Contact support</Link>
        </Button>
      </MessageCard>
    );
  }

  if (!isPermanentAuthState(auth)) {
    return (
      <MessageCard
        heading="Sign in to view your appraisals."
        description="Saved appraisals are private. Sign in with the account that owns them to continue."
      >
        <Button onClick={() => openSignIn({ returnTo: appraisalsPath })}>
          <ShieldCheck className="size-4" aria-hidden />
          Sign in
        </Button>
      </MessageCard>
    );
  }

  if (!service) {
    return (
      <MessageCard
        kind="error"
        heading="Your appraisals are temporarily unavailable."
        description="The secure appraisal service is not configured for this environment."
      >
        <Button asChild variant="outline">
          <Link to="/contact">Contact support</Link>
        </Button>
      </MessageCard>
    );
  }

  return (
    <AuthenticatedAppraisalsPage service={service} userId={auth.user.id} />
  );
}
