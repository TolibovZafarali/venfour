import { LoaderCircle, MailCheck } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth";
import { useTotalLossClaimRecoveryMutation } from "@/features/total-loss-claim/queries";
import { ApiError } from "@/lib/api/client";

interface ClaimRecoveryFormProps {
  readonly caseId: string;
}

function recoveryErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 429) {
    return "Too many requests were made. Please wait before trying again.";
  }
  if (error instanceof ApiError) {
    return "We couldn’t submit this request. Please try again.";
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return "We couldn’t submit this request. Please try again.";
}

export function ClaimRecoveryForm({ caseId }: ClaimRecoveryFormProps) {
  const { runTurnstileChallenge } = useAuth();
  const recovery = useTotalLossClaimRecoveryMutation({
    caseId,
    runTurnstileChallenge,
  });
  const [email, setEmail] = useState("");

  if (recovery.isSuccess) {
    return (
      <div aria-live="polite">
        <span className="flex size-11 items-center justify-center rounded-full bg-market-soft text-market-strong">
          <MailCheck className="size-5" aria-hidden />
        </span>
        <h2 className="mt-4 text-xl font-semibold tracking-[-0.025em] text-ink">
          Check your email
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-copy">
          If the claim details match, Venfour will send a secure link. For
          privacy, this confirmation is the same whether or not a matching claim
          was found.
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-5"
          onClick={() => recovery.reset()}
        >
          Request another link
        </Button>
      </div>
    );
  }

  return (
    <form
      className="max-w-xl"
      onSubmit={(event) => {
        event.preventDefault();
        const normalizedEmail = email.trim().toLowerCase();
        if (!normalizedEmail || recovery.isPending) return;
        recovery.mutate({ email: normalizedEmail });
      }}
    >
      <label
        htmlFor="claim-recovery-email"
        className="block text-sm font-semibold text-ink"
      >
        Email used for this claim
      </label>
      <input
        id="claim-recovery-email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => {
          setEmail(event.target.value);
          if (recovery.isError) recovery.reset();
        }}
        className="mt-2 min-h-11 w-full rounded-lg border border-line bg-white px-3.5 text-base text-ink outline-none transition-shadow placeholder:text-copy/55 focus:border-brand focus:ring-2 focus:ring-brand/20 motion-reduce:transition-none"
        placeholder="you@example.com"
      />
      <p className="mt-2 text-xs leading-5 text-copy">
        Venfour does not disclose whether a case or account matches this request.
      </p>
      {recovery.isError ? (
        <p className="mt-3 text-sm leading-6 text-red-700" role="alert">
          {recoveryErrorMessage(recovery.error)}
        </p>
      ) : null}
      <Button
        type="submit"
        className="mt-5 w-full sm:w-auto"
        disabled={recovery.isPending}
      >
        {recovery.isPending ? (
          <LoaderCircle
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden
          />
        ) : null}
        {recovery.isPending ? "Requesting link…" : "Request secure link"}
      </Button>
    </form>
  );
}
