import { Check, LockKeyhole, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Dialog, Switch } from "radix-ui";

import { useCookieConsent } from "@/features/privacy/cookie-consent-context";

const focusRingClassName =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2";

const bannerButtonClassName =
  "inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-[0.8125rem] font-semibold transition-colors motion-reduce:transition-none";

const policyLinkClassName =
  "rounded-sm font-medium text-ink underline decoration-ink/25 underline-offset-4 transition-colors hover:text-brand hover:decoration-brand/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none";

export function CookieConsent() {
  const {
    acceptAll,
    bannerVisible,
    consent,
    globalPrivacyControl,
    openPreferences,
    preferencesOpen,
    rejectNonEssential,
    savePreferences,
    setPreferencesOpen,
  } = useCookieConsent();

  return (
    <>
      {bannerVisible ? (
        <div className="width-before-scroll-bar pointer-events-none fixed inset-x-0 bottom-3 z-50 px-3 sm:bottom-5 sm:px-5">
          <section
            className="pointer-events-auto mx-auto w-full max-w-6xl rounded-2xl border border-ink/12 bg-white/96 p-4 shadow-[0_24px_64px_-24px_rgba(11,31,51,0.38),0_8px_24px_-16px_rgba(11,31,51,0.24)] backdrop-blur-xl sm:p-5"
            aria-labelledby="cookie-consent-title"
            aria-describedby="cookie-consent-description"
            aria-live="polite"
          >
            <div className="grid items-center gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-6">
              <div className="min-w-0">
                <h2
                  id="cookie-consent-title"
                  className="text-sm font-semibold tracking-[-0.01em] text-ink"
                >
                  Your privacy, your choice
                </h2>
                <p
                  id="cookie-consent-description"
                  className="mt-1 max-w-3xl text-[0.8125rem] leading-5 text-copy"
                >
                  Venfour uses essential cookies and similar storage to keep
                  this site working. We don’t currently use analytics; your
                  choice will control optional analytics if introduced.
                </p>
                <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-copy">
                  <Link to="/privacy" className={policyLinkClassName}>
                    Privacy Policy
                  </Link>
                  <Link to="/cookies" className={policyLinkClassName}>
                    Cookie Policy
                  </Link>
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:flex lg:items-center">
                <button
                  type="button"
                  className={`${bannerButtonClassName} ${focusRingClassName} bg-brand text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] hover:bg-brand-strong`}
                  onClick={acceptAll}
                >
                  Accept All
                </button>
                <button
                  type="button"
                  className={`${bannerButtonClassName} ${focusRingClassName} text-copy hover:bg-brand-soft hover:text-brand-strong`}
                  onClick={openPreferences}
                >
                  Manage Preferences
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {preferencesOpen ? (
        <CookiePreferencesDialog
          analyticsEnabled={consent?.analytics ?? false}
          globalPrivacyControl={globalPrivacyControl}
          open
          onOpenChange={setPreferencesOpen}
          onReject={rejectNonEssential}
          onSave={savePreferences}
        />
      ) : null}
    </>
  );
}

interface CookiePreferencesDialogProps {
  analyticsEnabled: boolean;
  globalPrivacyControl: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReject: () => void;
  onSave: (analytics: boolean) => void;
}

function CookiePreferencesDialog({
  analyticsEnabled,
  globalPrivacyControl,
  open,
  onOpenChange,
  onReject,
  onSave,
}: CookiePreferencesDialogProps) {
  const [analytics, setAnalytics] = useState(
    globalPrivacyControl ? false : analyticsEnabled,
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-ink/28 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in motion-reduce:animate-none" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-[61] max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-white/80 bg-white p-5 shadow-[0_28px_80px_-28px_rgba(11,31,51,0.55)] focus:outline-none sm:p-6">
          <div className="pr-10">
            <Dialog.Title className="text-xl font-semibold tracking-[-0.025em] text-ink">
              Cookie preferences
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm leading-6 text-copy">
              Essential storage is always active. Choose whether Venfour may use
              optional analytics if they are added in the future.
            </Dialog.Description>
          </div>

          <Dialog.Close asChild>
            <button
              type="button"
              className={`absolute top-4 right-4 inline-flex size-11 items-center justify-center rounded-lg text-copy transition-colors hover:bg-surface hover:text-ink ${focusRingClassName}`}
              aria-label="Close cookie preferences"
            >
              <X className="size-4" aria-hidden />
            </button>
          </Dialog.Close>

          <div className="mt-6 divide-y divide-line rounded-xl border border-line bg-surface/55">
            <div className="flex items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <LockKeyhole className="size-4 text-brand" aria-hidden />
                  <h3 className="text-sm font-semibold text-ink">Essential</h3>
                </div>
                <p className="mt-1 text-xs leading-5 text-copy">
                  Required for core site functions and to remember this choice.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="hidden text-[0.6875rem] font-semibold tracking-[0.08em] text-market-strong uppercase sm:inline">
                  Always on
                </span>
                <Switch.Root
                  checked
                  disabled
                  className="relative h-6 w-11 shrink-0 cursor-not-allowed rounded-full bg-market opacity-90"
                  aria-label="Essential cookies, always enabled"
                >
                  <Switch.Thumb className="block size-5 translate-x-[1.375rem] rounded-full bg-white shadow-sm" />
                </Switch.Root>
              </div>
            </div>

            <div className="flex items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-ink">Analytics</h3>
                <p className="mt-1 text-xs leading-5 text-copy">
                  Optional measurement tools. No analytics are active on
                  Venfour today.
                </p>
                {globalPrivacyControl ? (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-market-strong">
                    <Check className="size-3.5" aria-hidden />
                    Global Privacy Control is active, so analytics stay off.
                  </p>
                ) : null}
              </div>
              <Switch.Root
                checked={analytics}
                disabled={globalPrivacyControl}
                onCheckedChange={setAnalytics}
                className={`relative h-6 w-11 shrink-0 rounded-full bg-line-strong transition-colors data-[state=checked]:bg-brand disabled:cursor-not-allowed disabled:opacity-60 ${focusRingClassName}`}
                aria-label="Allow analytics"
              >
                <Switch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[1.375rem] motion-reduce:transition-none" />
              </Switch.Root>
            </div>
          </div>

          <p className="mt-4 text-xs leading-5 text-copy">
            Read the{" "}
            <Link to="/privacy" className={policyLinkClassName}>
              Privacy Policy
            </Link>{" "}
            and{" "}
            <Link to="/cookies" className={policyLinkClassName}>
              Cookie Policy
            </Link>
            .
          </p>

          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              className={`${bannerButtonClassName} ${focusRingClassName} border border-line bg-white text-ink hover:border-line-strong hover:bg-surface`}
              onClick={onReject}
            >
              Reject Non-Essential
            </button>
            <button
              type="button"
              className={`${bannerButtonClassName} ${focusRingClassName} bg-brand text-white hover:bg-brand-strong`}
              onClick={() => onSave(analytics)}
            >
              Save Preferences
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
