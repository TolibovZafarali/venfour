import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Link,
  Outlet,
  useLocation,
  useMatch,
  useMatches,
  useNavigate,
} from "react-router";

import { isPageMetadata, useDocumentMetadata } from "@/app/document-metadata";
import { supportEmail } from "@/config/support";
import { useAdminDiminishedValueDependencies } from "@/features/admin/diminished-value/dependencies";
import { useStaffAccessQuery } from "@/features/admin/diminished-value/queries";
import {
  AccountControl,
  isPermanentAuthState,
  MobileAccountControl,
  SignInDialogProvider,
  useAuth,
} from "@/features/auth";
import { useGuestAnalysisReturn } from "@/features/cases/guest-analysis-return";
import { CookieConsent } from "@/features/privacy/cookie-consent";
import { useCookieConsent } from "@/features/privacy/cookie-consent-context";
import { cn } from "@/lib/utils";
import { appRouteGradientClassName } from "@/pages/page-gradients";
import venfourMark from "../../../assets/brand/venfour-mark.svg";

const primaryLinkClassName =
  "inline-flex min-h-11 items-center rounded-lg px-3 text-[0.8125rem] font-medium text-ink/70 transition-colors hover:bg-white/55 hover:text-ink focus-visible:bg-white/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 motion-reduce:transition-none";

const footerLinkClassName =
  "inline-flex min-h-11 items-center rounded-sm text-sm text-copy transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none";

const mobileLinkClassName =
  "inline-flex min-h-12 items-center border-b border-ink/10 py-2 text-sm font-medium text-ink/75 transition-colors last:border-b-0 hover:bg-white/35 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/60 motion-reduce:transition-none";

export function AppShell() {
  return (
    <SignInDialogProvider>
      <AppShellContent />
    </SignInDialogProvider>
  );
}

function AppShellContent() {
  const analysisRoute = useMatch("/analyses/:runId");
  const totalLossCaseRoute = useMatch("/total-loss/cases/:caseId/*");
  const previewReturnRoute = useMatch("/auth/callback/preview/:caseId/:claimId");
  const previewReadyRoute = useMatch("/auth/callback/preview-ready/:caseId/:claimId");
  const findReviewRoute = useMatch("/find-review");
  const productFlowRoute = Boolean(analysisRoute || totalLossCaseRoute || previewReturnRoute || previewReadyRoute || findReviewRoute);
  const location = useLocation();
  const completedReviewRoute = /^\/total-loss\/cases\/[^/]+\/claim\/(overview|evidence|request|activity|guide(?:\/.*)?|review(?:\/.*)?)\/?$/.test(location.pathname);
  const adminRoute = location.pathname.startsWith("/admin/");
  const startFlowRoute =
    location.pathname === "/start" || location.pathname === "/total-loss/start";
  const matches = useMatches();
  const navigate = useNavigate();
  const { auth } = useAuth();
  const adminDependencies = useAdminDiminishedValueDependencies();
  const permanentUserId = isPermanentAuthState(auth) ? auth.user.id : null;
  const [staffNavigationRequestUserId, setStaffNavigationRequestUserId] =
    useState<string | null>(null);
  const staffAccessRequested =
    Boolean(permanentUserId) &&
    (adminRoute || staffNavigationRequestUserId === permanentUserId);
  const staffAccessQuery = useStaffAccessQuery({
    service: adminDependencies?.caseService ?? null,
    userId: staffAccessRequested ? permanentUserId : null,
  });
  const { openPreferences } = useCookieConsent();
  const [headerDetached, setHeaderDetached] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const headerSentinelRef = useRef<HTMLSpanElement>(null);
  const mobileNavigationButtonRef = useRef<HTMLButtonElement>(null);
  const previousPathnameRef = useRef(location.pathname);
  const clearingSectionHashRef = useRef(false);
  const metadata = [...matches]
    .reverse()
    .map((match) => match.handle)
    .find(isPageMetadata) ?? {
      title: "Vehicle Valuation Reviews After an Accident | Venfour",
      description:
        "Review a total-loss valuation with or without an insurer report. Diminished Value customer intake is currently paused.",
    };

  useDocumentMetadata(analysisRoute ? null : metadata);

  useEffect(() => {
    const isPageNavigation = previousPathnameRef.current !== location.pathname;
    previousPathnameRef.current = location.pathname;

    if (!location.hash) {
      if (clearingSectionHashRef.current) {
        clearingSectionHashRef.current = false;
        return;
      }

      if (isPageNavigation) {
        const resetScroll = () => {
          window.scrollTo({ top: 0, left: 0, behavior: "auto" });
        };

        resetScroll();

        const resetScrollTimeout = window.setTimeout(() => {
          if (window.scrollX !== 0 || window.scrollY !== 0) {
            resetScroll();
          }
        }, 100);

        return () => window.clearTimeout(resetScrollTimeout);
      }
      return;
    }

    const target = document.getElementById(location.hash.slice(1));
    if (!target) {
      return;
    }

    target.scrollIntoView?.({ block: "start" });
    target.focus({ preventScroll: true });
    clearingSectionHashRef.current = true;
    void navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, preventScrollReset: true },
    );
  }, [
    auth.status,
    location.hash,
    location.pathname,
    location.search,
    navigate,
  ]);

  useEffect(() => {
    const sentinel = headerSentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      setHeaderDetached(!entry.isIntersecting);
    });
    observer.observe(sentinel);

    return () => observer.disconnect();
  }, []);

  const onHomePage = location.pathname === "/";
  const guestReturn = useGuestAnalysisReturn(onHomePage);
  const resolvingHomeAudience = onHomePage && auth.status === "loading";
  const permanentHome = onHomePage && isPermanentAuthState(auth);
  const totalLossHref = onHomePage ? "#total-loss" : "/#total-loss";
  const diminishedValueHref = onHomePage
    ? "#diminished-value"
    : "/#diminished-value";
  const howItWorksHref = onHomePage ? "#how-it-works" : "/#how-it-works";
  const primaryActionHref = guestReturn.action?.href ?? "/start?service=total-loss";
  const requestStaffNavigation = () => {
    if (permanentUserId) setStaffNavigationRequestUserId(permanentUserId);
  };
  const staffReviewHref = staffAccessQuery.data
    ? "/admin/cases"
    : undefined;
  const visibleHeaderDetached =
    headerDetached && !startFlowRoute && !productFlowRoute;
  const detachedHeaderMaxWidth =
    analysisRoute || adminRoute ? "max-w-[90rem]" : "max-w-7xl";
  const headerMotionClassName = visibleHeaderDetached
    ? "duration-[560ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
    : "duration-[360ms] ease-[cubic-bezier(0.4,0,0.2,1)]";
  const glassMotionClassName = visibleHeaderDetached
    ? "duration-[640ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
    : "duration-[360ms] ease-[cubic-bezier(0.4,0,0.2,1)]";

  return (
    <div className="relative flex min-h-svh flex-col bg-background">
      <span
        ref={headerSentinelRef}
        className="pointer-events-none absolute top-0 left-0 h-px w-px"
        aria-hidden
      />
      <a
        href="#main-content"
        className="fixed top-2 left-2 z-50 inline-flex min-h-11 -translate-y-20 items-center rounded-md bg-brand px-4 text-sm font-medium text-white transition-transform focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 motion-reduce:transition-none"
      >
        Skip to content
      </a>
      <div className="sticky top-0 z-40 h-16 shrink-0">
        <header
          data-header-state={visibleHeaderDetached ? "detached" : "integrated"}
          className={cn(
            "absolute top-0 right-0 left-0 transition-[top,left,right] motion-reduce:transition-none",
            headerMotionClassName,
            visibleHeaderDetached &&
              "top-3 right-3 left-3 sm:right-4 sm:left-4",
          )}
          onKeyDown={(event) => {
            if (mobileNavigationOpen && event.key === "Escape") {
              setMobileNavigationOpen(false);
              mobileNavigationButtonRef.current?.focus();
            }
          }}
        >
          <div
            className={cn(
              "header-glass mx-auto w-full max-w-[100vw] overflow-hidden transition-[max-width,border-color,border-radius,box-shadow] motion-reduce:transition-none",
              glassMotionClassName,
              visibleHeaderDetached
                ? "rounded-2xl border border-white/75"
                : "border-b border-line/60",
              visibleHeaderDetached && detachedHeaderMaxWidth,
            )}
          >
            <div
              className={cn(
                "mx-auto flex min-h-16 w-full items-center justify-between gap-4 px-5 py-2.5 sm:px-8",
                analysisRoute || adminRoute
                  ? "max-w-[90rem] lg:px-10"
                  : "max-w-7xl",
              )}
            >
              <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                <Link
                  to="/"
                  className="notranslate inline-flex min-h-11 select-none items-center gap-[0.5625rem] rounded-md text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
                  aria-label="Venfour home"
                  translate="no"
                >
                  <img
                    src={venfourMark}
                    className="size-7"
                    alt=""
                    aria-hidden
                    data-brand-logo="venfour"
                  />
                  <span
                    className="font-brand text-[1.25rem] leading-none font-semibold tracking-[-0.035em] antialiased [font-kerning:normal] [text-rendering:geometricPrecision]"
                    data-brand-wordmark="venfour"
                  >
                    Venfour
                  </span>
                </Link>
                {adminRoute ? (
                  <span className="hidden border-l border-ink/10 pl-4 text-[0.6875rem] font-semibold tracking-[0.12em] text-copy/80 uppercase sm:block">
                    Staff review
                  </span>
                ) : null}
              </div>

              {completedReviewRoute ? (
                <div className="flex items-center gap-4">
                  {isPermanentAuthState(auth) && <Link to="/appraisals" className={primaryLinkClassName}>My appraisals</Link>}
                  <AccountControl className="shrink-0" onStaffNavigationRequest={requestStaffNavigation} staffReviewHref={staffReviewHref} />
                </div>
              ) : productFlowRoute ? null : startFlowRoute || adminRoute ? (
                <AccountControl
                  className="shrink-0"
                  onStaffNavigationRequest={requestStaffNavigation}
                  signedOutHint={
                    startFlowRoute ? "Already have an account?" : undefined
                  }
                  staffReviewHref={staffReviewHref}
                />
              ) : resolvingHomeAudience ? (
                <div
                  className="flex min-h-11 shrink-0 items-center gap-2"
                  data-home-navigation-state="loading"
                  aria-live="polite"
                >
                  <span className="sr-only">Checking sign-in status</span>
                  <span
                    className="hidden h-2.5 w-20 animate-pulse rounded-full bg-ink/10 lg:block motion-reduce:animate-none"
                    aria-hidden
                  />
                  <span
                    className="h-9 w-11 animate-pulse rounded-lg bg-ink/10 lg:hidden motion-reduce:animate-none"
                    aria-hidden
                  />
                </div>
              ) : (
                <>
                  <nav
                    className="hidden shrink-0 items-center gap-1 lg:flex lg:gap-2"
                    aria-label="Primary navigation"
                  >
                    {permanentHome ? (
                      <>
                        <Link
                          to="/appraisals"
                          className={primaryLinkClassName}
                        >
                          My appraisals
                        </Link>
                        <Link
                          to="/methodology"
                          className={primaryLinkClassName}
                        >
                          Methodology
                        </Link>
                        <Link to="/contact" className={primaryLinkClassName}>
                          Contact
                        </Link>
                        <AccountControl
                          onStaffNavigationRequest={requestStaffNavigation}
                          staffReviewHref={staffReviewHref}
                        />
                      </>
                    ) : (
                      <>
                        <a href={totalLossHref} className={primaryLinkClassName}>
                          Total Loss
                        </a>
                        <a
                          href={diminishedValueHref}
                          className={primaryLinkClassName}
                        >
                          Diminished Value
                        </a>
                        <a
                          href={howItWorksHref}
                          className={primaryLinkClassName}
                        >
                          How It Works
                        </a>
                        <AccountControl
                          onStaffNavigationRequest={requestStaffNavigation}
                          staffReviewHref={staffReviewHref}
                        />
                        {guestReturn.pending ? (
                          <span className="ml-1 inline-flex min-h-11 w-40 items-center justify-center rounded-lg bg-brand/10" role="status">
                            <span className="sr-only">Checking your saved review…</span>
                            <span className="h-2 w-20 animate-pulse rounded-full bg-brand/20 motion-reduce:animate-none" aria-hidden />
                          </span>
                        ) : <Link
                          to={primaryActionHref}
                          className="ml-1 inline-flex min-h-11 items-center rounded-lg border border-blue-300/20 bg-brand px-4 text-[0.8125rem] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_20px_-12px_rgba(21,94,239,0.95)] transition-colors hover:bg-[#2b6cf4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 motion-reduce:transition-none"
                        >
                          {guestReturn.action?.label ?? "Get Started"}
                        </Link>}
                      </>
                    )}
                  </nav>

                  <div className="flex shrink-0 items-center gap-1.5 lg:hidden">
                    {!permanentHome ? (
                      guestReturn.pending ? (
                        <span className="inline-flex min-h-11 w-24 items-center justify-center rounded-lg bg-brand/10" role="status">
                          <span className="sr-only">Checking your saved review…</span>
                          <span className="h-2 w-12 animate-pulse rounded-full bg-brand/20 motion-reduce:animate-none" aria-hidden />
                        </span>
                      ) : <Link
                        to={primaryActionHref}
                        aria-label={guestReturn.action?.label}
                        className="inline-flex min-h-11 max-w-30 items-center justify-center rounded-lg border border-blue-300/20 bg-brand px-2 text-center text-[0.6875rem] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_8px_20px_-12px_rgba(21,94,239,0.95)] transition-colors hover:bg-[#2b6cf4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 sm:px-3 sm:text-xs motion-reduce:transition-none"
                        onClick={() => setMobileNavigationOpen(false)}
                      >
                        {guestReturn.action?.compactLabel ?? "Get Started"}
                      </Link>
                    ) : null}
                    <button
                      ref={mobileNavigationButtonRef}
                      type="button"
                      className="inline-flex size-11 items-center justify-center rounded-lg text-copy transition-colors hover:bg-white/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 motion-reduce:transition-none"
                      aria-expanded={mobileNavigationOpen}
                      aria-controls="mobile-navigation"
                      aria-label={
                        mobileNavigationOpen
                          ? "Close navigation"
                          : "Open navigation"
                      }
                      onClick={() =>
                        setMobileNavigationOpen((open) => {
                          if (!open) requestStaffNavigation();
                          return !open;
                        })
                      }
                    >
                      {mobileNavigationOpen ? (
                        <X className="size-5" aria-hidden />
                      ) : (
                        <Menu className="size-5" aria-hidden />
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>

            {!startFlowRoute &&
            !adminRoute &&
            !productFlowRoute &&
            !resolvingHomeAudience &&
            mobileNavigationOpen ? (
              <nav
                id="mobile-navigation"
                className={cn(
                  "border-t border-ink/10 bg-transparent px-5 lg:hidden",
                  visibleHeaderDetached && "rounded-b-2xl",
                )}
                aria-label="Mobile navigation"
              >
                <div className="mx-auto flex w-full max-w-7xl flex-col py-2">
                  {permanentHome ? (
                    <>
                      <MobileAccountControl
                        className="border-t-0"
                        onAction={() => setMobileNavigationOpen(false)}
                        staffReviewHref={staffReviewHref}
                      />
                      <Link
                        to="/methodology"
                        className={mobileLinkClassName}
                        onClick={() => setMobileNavigationOpen(false)}
                      >
                        Methodology
                      </Link>
                      <Link
                        to="/contact"
                        className={mobileLinkClassName}
                        onClick={() => setMobileNavigationOpen(false)}
                      >
                        Contact
                      </Link>
                    </>
                  ) : (
                    <>
                      <a
                        href={totalLossHref}
                        className={mobileLinkClassName}
                        onClick={() => setMobileNavigationOpen(false)}
                      >
                        Total Loss
                      </a>
                      <a
                        href={diminishedValueHref}
                        className={mobileLinkClassName}
                        onClick={() => setMobileNavigationOpen(false)}
                      >
                        Diminished Value
                      </a>
                      <a
                        href={howItWorksHref}
                        className={mobileLinkClassName}
                        onClick={() => setMobileNavigationOpen(false)}
                      >
                        How It Works
                      </a>
                      <MobileAccountControl
                        className="border-t-0"
                        onAction={() => setMobileNavigationOpen(false)}
                        staffReviewHref={staffReviewHref}
                      />
                    </>
                  )}
                </div>
              </nav>
            ) : null}
          </div>
        </header>
      </div>
      <main
        id="main-content"
        className={cn(
          "flex flex-1",
          !completedReviewRoute && appRouteGradientClassName(location.pathname),
        )}
        tabIndex={-1}
      >
        <Outlet />
      </main>
      {productFlowRoute ? (
        <footer className="bg-canvas px-5 py-2 sm:px-8">
          <nav
            aria-label="Legal"
            className="mx-auto flex w-full items-center justify-center gap-5 text-xs text-copy"
          >
            <Link
              to="/terms"
              className="report-action-focus inline-flex min-h-11 items-center rounded-sm hover:text-ink"
            >
              Terms
            </Link>
            <Link
              to="/privacy"
              className="report-action-focus inline-flex min-h-11 items-center rounded-sm hover:text-ink"
            >
              Privacy
            </Link>
          </nav>
        </footer>
      ) : !startFlowRoute && !adminRoute ? (
        <footer className="site-footer-gradient border-t border-line bg-surface">
          <div className="mx-auto w-full max-w-7xl px-5 py-6 sm:px-8 sm:py-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-5">
                <Link
                  to="/"
                  className="notranslate inline-flex min-h-11 select-none items-center gap-2 rounded-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                  aria-label="Venfour home"
                  translate="no"
                >
                  <img
                    src={venfourMark}
                    className="size-6"
                    alt=""
                    aria-hidden
                    data-brand-logo="venfour"
                  />
                  <span
                    className="font-brand text-[1.125rem] leading-none font-semibold tracking-[-0.035em] antialiased [font-kerning:normal] [text-rendering:geometricPrecision]"
                    data-brand-wordmark="venfour"
                  >
                    Venfour
                  </span>
                </Link>
                {supportEmail ? (
                  <a
                    href={`mailto:${supportEmail}`}
                    className={footerLinkClassName}
                  >
                    {supportEmail}
                  </a>
                ) : null}
              </div>

              {!resolvingHomeAudience ? (
                <nav aria-label="Footer navigation">
                  <ul className="flex flex-wrap gap-x-5 gap-y-3">
                    {permanentHome ? (
                      <li>
                        <Link to="/appraisals" className={footerLinkClassName}>
                          My appraisals
                        </Link>
                      </li>
                    ) : (
                      <>
                        <li>
                          <a
                            href={totalLossHref}
                            className={footerLinkClassName}
                          >
                            Total Loss
                          </a>
                        </li>
                        <li>
                          <a
                            href={diminishedValueHref}
                            className={footerLinkClassName}
                          >
                            Diminished Value
                          </a>
                        </li>
                      </>
                    )}
                    <li>
                      <Link to="/methodology" className={footerLinkClassName}>
                        Methodology
                      </Link>
                    </li>
                    <li>
                      <Link to="/terms" className={footerLinkClassName}>
                        Terms
                      </Link>
                    </li>
                    <li>
                      <Link to="/privacy" className={footerLinkClassName}>
                        Privacy
                      </Link>
                    </li>
                    <li>
                      <Link to="/cookies" className={footerLinkClassName}>
                        Cookie Policy
                      </Link>
                    </li>
                    <li>
                      <Link to="/contact" className={footerLinkClassName}>
                        Contact
                      </Link>
                    </li>
                    <li>
                      <button
                        type="button"
                        className={footerLinkClassName}
                        onClick={openPreferences}
                      >
                        Cookie preferences
                      </button>
                    </li>
                  </ul>
                </nav>
              ) : (
                <div
                  className="flex min-h-11 items-center gap-2"
                  data-footer-navigation-state="loading"
                  aria-hidden
                >
                  <span className="h-2.5 w-20 animate-pulse rounded-full bg-ink/10 motion-reduce:animate-none" />
                  <span className="h-2.5 w-14 animate-pulse rounded-full bg-ink/10 motion-reduce:animate-none" />
                </div>
              )}
            </div>
            <p
              className="mt-4 border-t border-line pt-4 text-xs text-copy"
              data-footer-legal
            >
              © {new Date().getFullYear()}{" "}
              <span className="notranslate" translate="no">
                Venfour, LLC
              </span>
              . All rights reserved.
            </p>
          </div>
        </footer>
      ) : null}
      <CookieConsent />
    </div>
  );
}
