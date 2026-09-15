import { applicationHref, hostAudience } from "@/app/site-boundary";
import { publicSiteOnly } from "@/config/public-site";
import {
  CircleUserRound,
  ClipboardList,
  LogOut,
  Plus,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { DropdownMenu } from "radix-ui";
import type { User } from "@supabase/supabase-js";

import { getFriendlyAuthError } from "@/features/auth/auth-errors";
import {
  isPermanentAuthState,
  useAuth,
} from "@/features/auth/auth-context";
import { useSignInDialog } from "@/features/auth/sign-in-dialog-context";
import {
  getUserFullName,
  getUserIdentityLabel,
} from "@/features/auth/user-display";
import { useNewTotalLossAppraisalHref } from "@/features/total-loss/new-appraisal";
import { cn } from "@/lib/utils";
import { AppraisalSwitcher } from "@/features/cases/appraisal-switcher";
import { useCustomerProfileService } from "@/features/customer-profile/service-context";
import { useCustomerProfileQuery } from "@/features/customer-profile/queries";
import type { CustomerProfileService } from "@/features/customer-profile/service";

const focusRingClassName =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2";

interface AccountControlProps {
  className?: string;
  publicSessionHint?: boolean;
  onStaffNavigationRequest?: () => void;
  signedOutHint?: string;
  staffReviewHref?: string;
}

export function AccountControl({
  className,
  publicSessionHint,
  onStaffNavigationRequest,
  signedOutHint,
  staffReviewHref,
}: AccountControlProps) {
  const { auth, signOut } = useAuth();
  const { openSignIn } = useSignInDialog();
  const [signOutPending, setSignOutPending] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const newAppraisalHref = useNewTotalLossAppraisalHref();

  if (publicSiteOnly) return null;
  if (publicSessionHint !== undefined) {
    return publicSessionHint ? null : <a href={applicationHref("/app")} className={cn("inline-flex min-h-11 items-center px-3 text-sm text-ink", focusRingClassName, className)}>Sign In</a>;
  }

  if (auth.status === "loading") {
    return (
      <span
        className={cn(
          "inline-flex min-h-11 w-[5.25rem] items-center",
          signedOutHint && "sm:w-[13.5rem]",
          className,
        )}
        data-auth-state="loading"
      >
        <span className="sr-only">Checking sign-in status</span>
      </span>
    );
  }

  if (!isPermanentAuthState(auth)) {
    if (hostAudience() === "public") return <a href={applicationHref("/app")} className={cn("inline-flex min-h-11 items-center px-3 text-sm text-ink", focusRingClassName, className)}>Sign In</a>;
    const signInButton = (
      <button
        type="button"
        className={cn(
          "inline-flex min-h-11 items-center rounded-lg text-[0.8125rem] font-medium text-ink/70 transition-colors hover:bg-white/55 hover:text-ink motion-reduce:transition-none",
          signedOutHint ? "pr-3 pl-1" : "px-3",
          focusRingClassName,
          !signedOutHint && className,
        )}
        onClick={() => openSignIn()}
      >
        Sign In
      </button>
    );

    if (!signedOutHint) return signInButton;

    return (
      <span className={cn("inline-flex items-center", className)}>
        <span className="hidden whitespace-nowrap text-xs font-medium text-copy/80 sm:inline">
          {signedOutHint}
        </span>
        {signInButton}
      </span>
    );
  }

  const identityLabel = getUserIdentityLabel(auth.user);

  const performSignOut = async () => {
    setSignOutError(null);
    setSignOutPending(true);
    try {
      await signOut();
    } catch (error) {
      setSignOutError(getFriendlyAuthError(error, "signout"));
      setSignOutPending(false);
    }
  };

  return (
    <>
      <DropdownMenu.Root
        onOpenChange={(open) => {
          if (open) onStaffNavigationRequest?.();
        }}
      >
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            className={cn(
              "inline-flex min-h-11 max-w-36 items-center gap-2 rounded-lg px-3 text-[0.8125rem] font-medium text-ink/80 transition-colors hover:bg-white/55 hover:text-ink motion-reduce:transition-none",
              focusRingClassName,
              className,
            )}
            aria-label={`Account for ${identityLabel}`}
          >
            <CircleUserRound className="size-4 shrink-0" aria-hidden />
            <span className="truncate"><AccountName user={auth.user} /></span>
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content data-product-overlay
            align="end"
            sideOffset={8}
            className="z-[72] w-80 max-w-[calc(100vw-2rem)] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto rounded-xl border border-white/80 bg-white p-1.5 shadow-[0_20px_56px_-24px_rgba(11,31,51,0.5)]"
          >
            <DropdownMenu.Label className="px-2.5 py-2 text-xs text-copy">
              <span className="block font-semibold text-ink">Signed in as</span>
              <span className="mt-0.5 block max-w-64 truncate">
                {identityLabel}
              </span>
            </DropdownMenu.Label>
            <AppraisalSwitcher />
            <DropdownMenu.Separator className="my-1 h-px bg-line" />
            <DropdownMenu.Item asChild>
              <Link
                to={applicationHref(newAppraisalHref)}
                className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-ink outline-none transition-colors hover:bg-surface focus:bg-surface"
              >
                <Plus className="size-4" aria-hidden />
                Start new appraisal
              </Link>
            </DropdownMenu.Item>
            {staffReviewHref ? (
              <DropdownMenu.Item asChild>
                <Link
                  to={staffReviewHref}
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-ink outline-none transition-colors hover:bg-surface focus:bg-surface"
                >
                  <ClipboardList className="size-4" aria-hidden />
                  Staff review
                </Link>
              </DropdownMenu.Item>
            ) : null}
            <DropdownMenu.Separator className="my-1 h-px bg-line" />
            <DropdownMenu.Item
              asChild
              onSelect={(event) => event.preventDefault()}
            >
              <button
                type="button"
                className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm font-medium text-ink outline-none transition-colors hover:bg-surface focus:bg-surface disabled:cursor-not-allowed disabled:opacity-60"
                disabled={signOutPending}
                onClick={() => void performSignOut()}
              >
                <LogOut className="size-4" aria-hidden />
                {signOutPending ? "Signing out…" : "Sign Out"}
              </button>
            </DropdownMenu.Item>
            {signOutError ? (
              <p
                className="mx-2 mt-1 max-w-52 pb-1 text-xs leading-5 text-red-700"
                role="alert"
              >
                {signOutError}
              </p>
            ) : null}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>
  );
}

function AccountName({ user }: { user: User }) {
  const service = useCustomerProfileService();
  const fallback = getUserFullName(user)?.split(/\s+/)[0] ?? "Account";
  return service
    ? <ProfileAccountName service={service} userId={user.id} fallback={fallback} />
    : fallback;
}

function ProfileAccountName({ service, userId, fallback }: {
  service: CustomerProfileService;
  userId: string;
  fallback: string;
}) {
  const { data } = useCustomerProfileQuery({ service, userId });
  const name = data?.userId === userId ? data.fullName?.trim() : null;
  return name ? name.split(/\s+/)[0] : fallback;
}

interface MobileAccountControlProps {
  className?: string;
  publicSessionHint?: boolean;
  onAction?: () => void;
  staffReviewHref?: string;
}

export function MobileAccountControl({
  className,
  publicSessionHint,
  onAction,
  staffReviewHref,
}: MobileAccountControlProps) {
  const { auth, signOut } = useAuth();
  const { openSignIn } = useSignInDialog();
  const [signOutPending, setSignOutPending] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const newAppraisalHref = useNewTotalLossAppraisalHref();

  if (publicSiteOnly) return null;
  if (publicSessionHint !== undefined) {
    return <a href={applicationHref("/app")} onClick={onAction} className={cn("inline-flex min-h-12 items-center border-t border-ink/10 py-2 text-sm font-medium text-ink/75", focusRingClassName, className)}>{publicSessionHint ? "Open app" : "Sign In"}</a>;
  }

  if (auth.status === "loading") {
    return (
      <span
        className={cn("block min-h-12 border-t border-ink/10", className)}
        data-auth-state="loading"
      >
        <span className="sr-only">Checking sign-in status</span>
      </span>
    );
  }

  if (!isPermanentAuthState(auth)) {
    if (hostAudience() === "public") return <a href={applicationHref("/app")} className={cn("inline-flex min-h-11 items-center px-3 text-sm text-ink", focusRingClassName, className)}>Sign In</a>;
    return (
      <button
        type="button"
        className={cn(
          "inline-flex min-h-12 w-full items-center border-t border-ink/10 py-2 text-sm font-medium text-ink/75 transition-colors hover:bg-white/35 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/60",
          className,
        )}
        onClick={() => {
          openSignIn();
        }}
      >
        Sign In
      </button>
    );
  }

  const identityLabel = getUserIdentityLabel(auth.user);

  const performSignOut = async () => {
    setSignOutError(null);
    setSignOutPending(true);
    try {
      await signOut();
      onAction?.();
    } catch (error) {
      setSignOutError(getFriendlyAuthError(error, "signout"));
      setSignOutPending(false);
    }
  };

  return (
    <div className={cn("border-t border-ink/10 py-2", className)}>
      <p className="truncate px-1 text-xs text-copy">
        Signed in as{" "}
        <span className="font-semibold text-ink">{identityLabel}</span>
      </p>
      <AppraisalSwitcher menu={false} onAction={onAction} />
      <Link
        to={applicationHref(newAppraisalHref)}
        className="mt-1 inline-flex min-h-11 w-full items-center gap-2 rounded-lg px-1 text-sm font-medium text-ink/75 transition-colors hover:bg-white/35 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/60"
        onClick={onAction}
      >
        <Plus className="size-4" aria-hidden />
        Start new appraisal
      </Link>
      {staffReviewHref ? (
        <Link
          to={staffReviewHref}
          className="mt-1 inline-flex min-h-11 w-full items-center gap-2 rounded-lg px-1 text-sm font-medium text-ink/75 transition-colors hover:bg-white/35 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/60"
          onClick={onAction}
        >
          <ClipboardList className="size-4" aria-hidden />
          Staff review
        </Link>
      ) : null}
      <button
        type="button"
        className="mt-1 inline-flex min-h-11 w-full items-center gap-2 rounded-lg px-1 text-sm font-medium text-ink/75 transition-colors hover:bg-white/35 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/60 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={signOutPending}
        onClick={() => void performSignOut()}
      >
        <LogOut className="size-4" aria-hidden />
        {signOutPending ? "Signing out…" : "Sign Out"}
      </button>
      {signOutError ? (
        <p className="px-1 pb-1 text-xs leading-5 text-red-700" role="alert">
          {signOutError}
        </p>
      ) : null}
    </div>
  );
}
