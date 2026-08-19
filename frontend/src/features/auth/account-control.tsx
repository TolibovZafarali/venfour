import { CircleUserRound, LogOut } from "lucide-react";
import { useState } from "react";
import { DropdownMenu } from "radix-ui";

import { getFriendlyAuthError } from "@/features/auth/auth-errors";
import { useAuth } from "@/features/auth/auth-context";
import { useSignInDialog } from "@/features/auth/sign-in-dialog-context";
import {
  getUserAccountLabel,
  getUserIdentityLabel,
} from "@/features/auth/user-display";
import { cn } from "@/lib/utils";

const focusRingClassName =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2";

interface AccountControlProps {
  className?: string;
  signedOutHint?: string;
}

export function AccountControl({
  className,
  signedOutHint,
}: AccountControlProps) {
  const { auth, signOut } = useAuth();
  const { openSignIn } = useSignInDialog();
  const [signOutPending, setSignOutPending] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

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

  if (auth.status !== "signedIn") {
    const signInButton = (
      <button
        type="button"
        className={cn(
          "inline-flex min-h-11 items-center rounded-lg px-3 text-[0.8125rem] font-medium text-ink/70 transition-colors hover:bg-white/55 hover:text-ink motion-reduce:transition-none",
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
      <span className={cn("inline-flex items-center gap-2", className)}>
        <span className="hidden whitespace-nowrap text-xs font-medium text-copy/80 sm:inline">
          {signedOutHint}
        </span>
        {signInButton}
      </span>
    );
  }

  const accountLabel = getUserAccountLabel(auth.user);
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
      <DropdownMenu.Root>
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
            <span className="truncate">{accountLabel}</span>
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={8}
            className="z-[72] min-w-56 rounded-xl border border-white/80 bg-white p-1.5 shadow-[0_20px_56px_-24px_rgba(11,31,51,0.5)]"
          >
            <DropdownMenu.Label className="px-2.5 py-2 text-xs text-copy">
              <span className="block font-semibold text-ink">Signed in as</span>
              <span className="mt-0.5 block max-w-64 truncate">
                {identityLabel}
              </span>
            </DropdownMenu.Label>
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

interface MobileAccountControlProps {
  className?: string;
  onAction?: () => void;
}

export function MobileAccountControl({
  className,
  onAction,
}: MobileAccountControlProps) {
  const { auth, signOut } = useAuth();
  const { openSignIn } = useSignInDialog();
  const [signOutPending, setSignOutPending] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

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

  if (auth.status !== "signedIn") {
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
        Signed in as <span className="font-semibold text-ink">{identityLabel}</span>
      </p>
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
