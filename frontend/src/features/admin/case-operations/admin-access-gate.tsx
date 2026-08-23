import { RefreshCw, ShieldCheck } from "lucide-react";
import { Link, Outlet, useLocation } from "react-router";

import { Button } from "@/components/ui/button";
import { AdminRouteState } from "@/features/admin/diminished-value/admin-route-state";
import { useAuth, useSignInDialog } from "@/features/auth";

import { useAdminCaseOperationsDependencies } from "./dependencies";
import { useStaffCaseOperationsAccessQuery } from "./queries";

export function AdminCaseOperationsAccessGate() {
  const { auth } = useAuth();
  const { openSignIn } = useSignInDialog();
  const dependencies = useAdminCaseOperationsDependencies();
  const location = useLocation();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const accessQuery = useStaffCaseOperationsAccessQuery({
    service: dependencies?.caseService ?? null,
    userId,
  });

  if (auth.status === "loading") {
    return (
      <AdminRouteState
        kind="loading"
        eyebrow="Secure case operations"
        heading="Checking your sign-in…"
        description="Venfour is confirming your session before opening the case workspace."
      />
    );
  }

  if (auth.status === "signedOut") {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <AdminRouteState
        eyebrow="Secure case operations"
        heading="Sign in to continue."
        description="This workspace is available only to authorized Venfour staff."
      >
        <Button
          onClick={() => openSignIn({ intent: "staff-review", returnTo })}
        >
          <ShieldCheck className="size-4" aria-hidden />
          Sign in
        </Button>
      </AdminRouteState>
    );
  }

  if (auth.status === "unavailable" || !dependencies) {
    return (
      <AdminRouteState
        kind="error"
        eyebrow="Case operations unavailable"
        heading="We can’t securely open this workspace right now."
        description={
          auth.status === "unavailable"
            ? auth.reason
            : "The secure case-operations service is not configured for this environment."
        }
      />
    );
  }

  if (accessQuery.isPending) {
    return (
      <AdminRouteState
        kind="loading"
        eyebrow="Secure case operations"
        heading="Checking staff access…"
        description="Venfour is verifying that this account can inspect customer cases."
      />
    );
  }

  if (accessQuery.isError) {
    return (
      <AdminRouteState
        kind="error"
        eyebrow="Unable to verify access"
        heading="We couldn’t open the case workspace."
        description="A temporary connection problem prevented Venfour from checking staff access."
      >
        <Button variant="outline" onClick={() => void accessQuery.refetch()}>
          <RefreshCw className="size-4" aria-hidden />
          Try again
        </Button>
      </AdminRouteState>
    );
  }

  if (!accessQuery.data) {
    return (
      <AdminRouteState
        kind="unavailable"
        eyebrow="Page unavailable"
        heading="We couldn’t find this page."
        description="The address may be incorrect, or this page may not be available to your account."
      >
        <Button asChild variant="outline">
          <Link to="/">Return home</Link>
        </Button>
      </AdminRouteState>
    );
  }

  return <Outlet />;
}
