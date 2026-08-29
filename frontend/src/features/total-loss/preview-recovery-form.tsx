import { useMutation } from "@tanstack/react-query";
import { LoaderCircle, MailCheck } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { environment } from "@/config/env";
import { useAuth } from "@/features/auth";
import { createApiClient } from "@/lib/api/client";

const apiClient = createApiClient({ baseUrl: environment.apiBaseUrl });

export function PreviewRecoveryForm({ caseId }: { readonly caseId?: string }) {
  const emailId = useId();
  const [email, setEmail] = useState("");
  const { runTurnstileChallenge } = useAuth();
  const recovery = useMutation({
    gcTime: 0,
    retry: false,
    mutationFn: (email: string) => runTurnstileChallenge("claim-recovery", async (turnstileToken) => {
      const path = caseId
        ? `/api/v1/appraisal-cases/${encodeURIComponent(caseId)}/preview-access/recovery`
        : "/api/v1/preview-access/recovery";
      const response = await apiClient.postJson<{ status: string }>(path, { email, turnstileToken });
      if (response.status !== "accepted") throw new Error("The recovery response is invalid.");
    }),
  });

  if (recovery.isSuccess) {
    return (
      <div aria-live="polite" className="w-full">
        <MailCheck className="size-7 text-market" aria-hidden />
        <h2 className="mt-4 text-xl font-semibold text-ink">Check your email</h2>
        <p className="mt-2 text-sm leading-6 text-copy">
          If we find a matching review, we’ll email a secure link to return to it.
          {!caseId ? " If you have more than one, the link opens your most recent review." : ""}
        </p>
        <Button className="mt-5" variant="outline" onClick={() => recovery.reset()}>
          Request another link
        </Button>
      </div>
    );
  }

  return (
    <form className="w-full" onSubmit={(event) => {
      event.preventDefault();
      if (email.trim() && !recovery.isPending) recovery.mutate(email.trim().toLowerCase());
    }}>
      <label htmlFor={emailId} className="block text-sm font-semibold text-ink">
        Email used for your review
      </label>
      <input id={emailId} type="email" autoComplete="email" required
        value={email} onChange={(event) => setEmail(event.target.value)}
        placeholder="you@example.com"
        className="mt-2 min-h-12 w-full rounded-xl border border-line bg-white px-4 text-base text-ink outline-none placeholder:text-copy/60 focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
      <p className="mt-3 text-xs leading-5 text-copy">
        Your review stays private. We use a secure email link to help you return.
      </p>
      {recovery.isError ? (
        <p role="alert" className="mt-3 text-sm leading-6 text-red-700">
          We couldn’t submit your request. Please try again.
        </p>
      ) : null}
      <Button type="submit" size="lg" className="mt-5 w-full rounded-xl" disabled={recovery.isPending}>
        {recovery.isPending ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
        {recovery.isPending ? "Requesting link…" : "Email me a return link"}
      </Button>
    </form>
  );
}
