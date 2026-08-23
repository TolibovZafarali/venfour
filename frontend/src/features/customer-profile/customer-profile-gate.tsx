import { AlertCircle, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";

import { useAuth, useSignInDialog } from "@/features/auth";
import { getUserFullName } from "@/features/auth/user-display";
import {
  FlowCard,
  primaryFlowButtonClassName,
  totalLossInputClassName,
} from "@/features/total-loss/intake-fields";

import {
  useConfirmCustomerProfileMutation,
  useCustomerProfileQuery,
} from "./queries";
import { normalizeCustomerFullName } from "./service";
import { useCustomerProfileService } from "./service-context";
import { isCustomerProfileConfirmed } from "./types";

interface CustomerProfileGateProps {
  readonly children: ReactNode;
  readonly returnTo: string;
}

export function CustomerProfileGate({
  children,
  returnTo,
}: CustomerProfileGateProps) {
  const { auth } = useAuth();
  const { openSignIn } = useSignInDialog();
  const service = useCustomerProfileService();
  const userId = auth.status === "signedIn" ? auth.user.id : null;
  const profileQuery = useCustomerProfileQuery({ service, userId });

  if (auth.status === "loading") {
    return <ProfileLoadingCard message="Checking your secure account…" />;
  }

  if (auth.status === "signedOut") {
    return (
      <FlowCard className="text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">
          <ShieldCheck className="size-6" aria-hidden />
        </span>
        <p className="mt-6 text-sm font-semibold tracking-[0.12em] text-brand uppercase">
          Secure account required
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-[-0.035em] text-ink sm:text-3xl">
          Sign in before starting your review
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-copy">
          Your account keeps one durable Total Loss draft available if you
          leave, refresh, or continue on another device.
        </p>
        <button
          type="button"
          className={`${primaryFlowButtonClassName} mt-7`}
          onClick={() =>
            openSignIn({ returnTo, intent: "continue-total-loss" })
          }
        >
          Sign in to continue
        </button>
      </FlowCard>
    );
  }

  if (auth.status === "unavailable" || !service) {
    return (
      <ProfileErrorCard
        title="Secure account setup is unavailable"
        message={
          auth.status === "unavailable"
            ? auth.reason
            : "Venfour could not connect to secure profile storage."
        }
      />
    );
  }

  if (profileQuery.isPending) {
    return <ProfileLoadingCard message="Loading your customer profile…" />;
  }

  if (profileQuery.isError) {
    return (
      <ProfileErrorCard
        title="We couldn’t load your customer profile"
        message="Your Total Loss draft has not been created. Try loading your profile again."
        actionLabel="Try again"
        onAction={() => void profileQuery.refetch()}
      />
    );
  }

  if (
    auth.user.email &&
    auth.user.email_confirmed_at &&
    isCustomerProfileConfirmed(profileQuery.data)
  ) {
    return children;
  }

  return (
    <CustomerProfileConfirmationForm
      key={`${auth.user.id}:${profileQuery.data?.updatedAt ?? "unconfirmed"}`}
      email={
        auth.user.email && auth.user.email_confirmed_at ? auth.user.email : null
      }
      initialOperationalFollowUpAllowed={
        profileQuery.data?.operationalFollowUpAllowed ?? false
      }
      suggestedFullName={
        profileQuery.data?.fullName ?? getUserFullName(auth.user) ?? ""
      }
      service={service}
      userId={auth.user.id}
    />
  );
}

function CustomerProfileConfirmationForm({
  email,
  initialOperationalFollowUpAllowed,
  suggestedFullName,
  service,
  userId,
}: {
  readonly email: string | null;
  readonly initialOperationalFollowUpAllowed: boolean;
  readonly suggestedFullName: string;
  readonly service: NonNullable<ReturnType<typeof useCustomerProfileService>>;
  readonly userId: string;
}) {
  const [fullName, setFullName] = useState(suggestedFullName);
  const [serviceTermsAccepted, setServiceTermsAccepted] = useState(false);
  const [privacyNoticeAccepted, setPrivacyNoticeAccepted] = useState(false);
  const [operationalFollowUpAllowed, setOperationalFollowUpAllowed] = useState(
    initialOperationalFollowUpAllowed,
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const confirmProfile = useConfirmCustomerProfileMutation({ service, userId });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedName = normalizeCustomerFullName(fullName);
    if (normalizedName.length < 1) {
      setValidationError("Enter your full name.");
      return;
    }
    if (!serviceTermsAccepted || !privacyNoticeAccepted) {
      setValidationError(
        "Confirm the required Terms of Use and Privacy Policy acknowledgements.",
      );
      return;
    }
    if (!email) {
      setValidationError(
        "This account does not have a verified email. Use a different account to continue.",
      );
      return;
    }
    setValidationError(null);
    confirmProfile.mutate({
      fullName: normalizedName,
      operationalFollowUpAllowed,
    });
  };

  const error =
    validationError ??
    (confirmProfile.isError
      ? "We couldn’t confirm your profile. Your Total Loss draft has not been created."
      : null);

  return (
    <FlowCard>
      <span className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">
        <UserRound className="size-6" aria-hidden />
      </span>
      <p className="mt-6 text-sm font-semibold tracking-[0.12em] text-brand uppercase">
        Customer profile
      </p>
      <h2 className="mt-3 text-2xl font-semibold tracking-[-0.035em] text-ink sm:text-3xl">
        Confirm your information
      </h2>
      <p className="mt-3 max-w-xl text-sm leading-6 text-copy">
        Confirm or correct the suggested name. Venfour uses your verified
        account email as your email identity.
      </p>

      <form className="mt-7 space-y-5" onSubmit={submit} noValidate>
        <div>
          <label
            htmlFor="customer-profile-full-name"
            className="text-sm font-semibold text-ink"
          >
            Full name
          </label>
          <input
            id="customer-profile-full-name"
            className={totalLossInputClassName}
            value={fullName}
            maxLength={200}
            autoComplete="name"
            disabled={confirmProfile.isPending}
            aria-invalid={
              validationError?.startsWith("Enter your full name") || undefined
            }
            onChange={(event) => {
              setFullName(event.target.value);
              setValidationError(null);
            }}
          />
        </div>

        <div>
          <label
            htmlFor="customer-profile-email"
            className="text-sm font-semibold text-ink"
          >
            Verified email
          </label>
          <input
            id="customer-profile-email"
            className={`${totalLossInputClassName} bg-surface text-copy`}
            type="email"
            value={email ?? "Email unavailable"}
            readOnly
            aria-readonly="true"
          />
          <p className="mt-1.5 text-xs leading-5 text-copy">
            Managed by your secure sign-in account and not editable here.
          </p>
        </div>

        <RequiredAcknowledgement
          checked={serviceTermsAccepted}
          disabled={confirmProfile.isPending}
          onChange={setServiceTermsAccepted}
        >
          I agree to Venfour’s <PolicyLink to="/terms">Terms of Use</PolicyLink>
          .
        </RequiredAcknowledgement>
        <RequiredAcknowledgement
          checked={privacyNoticeAccepted}
          disabled={confirmProfile.isPending}
          onChange={setPrivacyNoticeAccepted}
        >
          I acknowledge Venfour’s{" "}
          <PolicyLink to="/privacy">Privacy Policy</PolicyLink>.
        </RequiredAcknowledgement>

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface/60 p-4">
          <input
            type="checkbox"
            className="mt-1 size-4 shrink-0 accent-brand"
            checked={operationalFollowUpAllowed}
            disabled={confirmProfile.isPending}
            onChange={(event) =>
              setOperationalFollowUpAllowed(event.target.checked)
            }
          />
          <span>
            <span className="block text-sm font-semibold text-ink">
              Allow optional operational follow-up
            </span>
            <span className="mt-1 block text-xs leading-5 text-copy">
              Venfour may contact you about this case or service follow-up. This
              optional choice does not control essential messages needed to
              provide a service you request.
            </span>
          </span>
        </label>

        {error ? (
          <p className="text-sm leading-6 text-red-700" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          className={primaryFlowButtonClassName}
          disabled={confirmProfile.isPending}
        >
          {confirmProfile.isPending ? "Confirming…" : "Confirm and continue"}
        </button>
      </form>
    </FlowCard>
  );
}

function RequiredAcknowledgement({
  checked,
  children,
  disabled,
  onChange,
}: {
  readonly checked: boolean;
  readonly children: ReactNode;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-4">
      <input
        type="checkbox"
        className="mt-1 size-4 shrink-0 accent-brand"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="text-sm leading-6 text-copy">{children}</span>
    </label>
  );
}

function PolicyLink({ children, to }: { children: ReactNode; to: string }) {
  return (
    <Link
      className="rounded-sm font-semibold text-ink underline decoration-ink/25 underline-offset-4 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      target="_blank"
      rel="noreferrer"
      to={to}
    >
      {children}
    </Link>
  );
}

function ProfileLoadingCard({ message }: { readonly message: string }) {
  return (
    <FlowCard className="text-center" busy>
      <RefreshCw
        className="mx-auto size-6 animate-spin text-brand motion-reduce:animate-none"
        aria-hidden
      />
      <p className="mt-3 text-sm font-semibold text-ink" role="status">
        {message}
      </p>
    </FlowCard>
  );
}

function ProfileErrorCard({
  actionLabel,
  message,
  onAction,
  title,
}: {
  readonly actionLabel?: string;
  readonly message: string;
  readonly onAction?: () => void;
  readonly title: string;
}) {
  return (
    <FlowCard className="text-center">
      <AlertCircle className="mx-auto size-7 text-red-700" aria-hidden />
      <h2 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-ink">
        {title}
      </h2>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-copy">
        {message}
      </p>
      {actionLabel && onAction ? (
        <button
          type="button"
          className={`${primaryFlowButtonClassName} mt-6`}
          onClick={onAction}
        >
          {actionLabel}
        </button>
      ) : null}
    </FlowCard>
  );
}
