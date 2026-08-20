import { RefreshCw, ShieldCheck } from "lucide-react";
import { Link, Outlet, useLocation } from "react-router";

import { Button } from "@/components/ui/button";
import { useAuth, useSignInDialog } from "@/features/auth";

import { AdminRouteState } from "./admin-route-state";
import { useAdminDiminishedValueDependencies } from "./dependencies";
import { useStaffAccessQuery } from "./queries";

export function AdminDiminishedValueAccessGate() {
  const { auth } = useAuth();
  const { openSignIn } = useSignInDialog();
  const dependencies = useAdminDiminishedValueDependencies();
  const location = useLocation();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const accessQuery = useStaffAccessQuery({
    service: dependencies?.caseService ?? null,
    userId,
  });

  if (auth.status === "loading") {
    return (
      <AdminRouteState
        kind="loading"
        eyebrow="Secure staff review"
        heading="Checking your sign-in…"
        description="Venfour is confirming your session before opening the review workspace."
      />
    );
  }

  if (auth.status === "signedOut") {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <AdminRouteState
        eyebrow="Secure staff review"
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
        eyebrow="Staff access unavailable"
        heading="We can’t securely open this workspace right now."
        description={
          auth.status === "unavailable"
            ? auth.reason
            : "The secure staff-review service is not configured for this environment."
        }
      />
    );
  }

  if (accessQuery.isPending) {
    return (
      <AdminRouteState
        kind="loading"
        eyebrow="Secure staff review"
        heading="Checking staff access…"
        description="Venfour is verifying that this account can review submitted requests."
      />
    );
  }

  if (accessQuery.isError) {
    return (
      <AdminRouteState
        kind="error"
        eyebrow="Unable to verify access"
        heading="We couldn’t open the staff workspace."
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
