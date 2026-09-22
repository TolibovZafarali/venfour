import { applicationHref, hostAudience, publicHref, routeAudience } from "@/app/site-boundary";
import { visualSystemForLocation } from "@/app/visual-system";
import { publicSiteOnly, publicIntakeClosed } from "@/config/public-site";
import { useWorkspaceEntryAction } from "@/features/cases/workspace-entry";
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
import { CompletedReviewActionsHostContext, CompletedReviewNavigationHostContext, CompletedReviewProgressHostContext } from "@/components/completed-review-progress-host";
import { diminishedValueIntakeAvailable } from "@/config/product-availability";
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
import { usePublicSessionHint } from "@/features/auth/public-session-hint";
import { CookieConsent } from "@/features/privacy/cookie-consent";
import { useCookieConsent } from "@/features/privacy/cookie-consent-context";
import { cn } from "@/lib/utils";
import { useHomeSmoothScroll } from "@/pages/use-home-smooth-scroll";
import { FreeValuationProcessingProvider } from "@/features/analyses/components/free-valuation-processing";
import { CustomerWorkspace, CustomerWorkspaceIdentity } from "@/components/customer-workspace";
import venfourMark from "../../../assets/brand/venfour-mark.svg";

const primaryLinkClassName =
  "inline-flex min-h-11 items-center rounded-lg px-3 text-[0.8125rem] font-medium text-ink/70 transition-colors hover:bg-white/55 hover:text-ink focus-visible:bg-white/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 motion-reduce:transition-none";

const footerLinkClassName =
  "public-footer__link";

const mobileLinkClassName =
  "inline-flex min-h-12 items-center border-b border-ink/10 py-2 text-sm font-medium text-ink/75 transition-colors last:border-b-0 hover:bg-white/35 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/60 motion-reduce:transition-none";

export function AppShell() {
  const { auth } = useAuth();
  const caseRoute = useMatch("/total-loss/cases/:caseId/*");
  const analysisRoute = useMatch("/analyses/:runId");
  const location = useLocation();
  const search = new URLSearchParams(location.search);
  const intakeCaseId = location.pathname === "/start" && search.get("service") !== "diminished-value" ? search.get("caseId") : null;
  const workspace = Boolean(caseRoute || analysisRoute || intakeCaseId);
  return (
    <SignInDialogProvider>
      <FreeValuationProcessingProvider inline={workspace} accountControl={isPermanentAuthState(auth) ? <AccountControl /> : null}>
        <AppShellContent workspace={workspace} workspaceCaseId={caseRoute?.params.caseId ?? intakeCaseId ?? undefined} />
      </FreeValuationProcessingProvider>
    </SignInDialogProvider>
  );
}

function AppShellContent({ workspace, workspaceCaseId }: { workspace: boolean; workspaceCaseId?: string }) {
  const localStatusRoute = useMatch("/_local/status-experience");
  const analysisRoute = useMatch("/analyses/:runId");
  const totalLossCaseRoute = useMatch("/total-loss/cases/:caseId/*");
  const appraisalsRoute = useMatch("/appraisals");
  const previewReturnRoute = useMatch("/auth/callback/preview/:caseId/:claimId");
  const previewReadyRoute = useMatch("/auth/callback/preview-ready/:caseId/:claimId");
  const findReviewRoute = useMatch("/find-review");
  const appEntryRoute = useMatch("/app");
  const productFlowRoute = Boolean(appEntryRoute || appraisalsRoute || localStatusRoute || analysisRoute || totalLossCaseRoute || previewReturnRoute || previewReadyRoute || findReviewRoute);
  const location = useLocation();
  const publicSite = routeAudience(location.pathname) === "public";
  const appVisualSystem = visualSystemForLocation(location.pathname) === "app";
  const productionPublicPage = publicSiteOnly || (publicSite && hostAudience() === "public");
  const publicSessionHint = usePublicSessionHint();
  const completedReviewRoute = /^\/total-loss\/cases\/[^/]+\/claim\/(overview|evidence|request|activity|guide(?:\/.*)?|review(?:\/.*)?)\/?$/.test(location.pathname);
  const adminRoute = location.pathname === "/admin" || location.pathname.startsWith("/admin/");
  const startFlowRoute =
    location.pathname === "/start" || location.pathname === "/total-loss/start";
  const matches = useMatches();
  const navigate = useNavigate();
  const { auth } = useAuth();
  const adminDependencies = useAdminDiminishedValueDependencies();
  const permanentUserId = !productionPublicPage && isPermanentAuthState(auth) ? auth.user.id : null;
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
  const [completedReviewProgressHost, setCompletedReviewProgressHost] =
    useState<HTMLDivElement | null>(null);
  const [completedReviewNavigationHost, setCompletedReviewNavigationHost] =
    useState<HTMLDivElement | null>(null);
  const [completedReviewActionsHost, setCompletedReviewActionsHost] =
    useState<HTMLDivElement | null>(null);
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
  const scrollToSection = useHomeSmoothScroll(
    location.pathname === "/",
  );

  useEffect(() => {
    const isPageNavigation = previousPathnameRef.current !== location.pathname;
    previousPathnameRef.current = location.pathname;

    if (!location.hash) {
      if (clearingSectionHashRef.current) {
        clearingSectionHashRef.current = false;
        return;
      }

      if (isPageNavigation) {
        if (document.querySelector("[data-completed-review] .completed-analysis")) return;
        const resetScroll = () => {
          // A smooth homepage reset would trigger every entrance along the way.
          window.scrollTo({
            top: 0,
            left: 0,
            behavior: document.querySelector("[data-home-motion]") ? "instant" : "auto",
          });
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

    if (target instanceof HTMLDetailsElement) target.open = true;
    scrollToSection(target);
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
    scrollToSection,
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
  const guestReturn = useGuestAnalysisReturn(onHomePage && !productionPublicPage);
  const workspaceAction = useWorkspaceEntryAction(publicSite && !productionPublicPage);
  const focusedCaseAccountHeader =
    workspace || location.pathname === "/app" || Boolean(appraisalsRoute) || location.pathname.startsWith("/partners") ||
    completedReviewRoute ||
    (Boolean(totalLossCaseRoute) && isPermanentAuthState(auth));
  const totalLossHref = onHomePage ? "#total-loss" : publicHref("/#total-loss");
  const brandHref = startFlowRoute
    ? publicHref()
    : hostAudience() === "application" || (!publicSite && isPermanentAuthState(auth))
      ? applicationHref("/app")
      : publicHref();
  const diminishedValueHref = onHomePage
    ? "#diminished-value"
    : publicHref("/#diminished-value");
  const howItWorksHref = onHomePage ? "#how-it-works" : publicHref("/#how-it-works");
  const primaryActionHref = publicIntakeClosed ? "/contact" : productionPublicPage
    ? applicationHref(publicSessionHint ? "/app" : "/start?service=total-loss")
    : isPermanentAuthState(auth) ? workspaceAction.href : guestReturn.action?.href ?? applicationHref("/start?service=total-loss");
  const primaryActionLabel = publicIntakeClosed ? "Contact Venfour" : productionPublicPage
    ? publicSessionHint ? "Open app" : "Get Started"
    : isPermanentAuthState(auth) ? workspaceAction.label : guestReturn.action?.label ?? "Get Started";
  const requestStaffNavigation = () => {
    if (permanentUserId) setStaffNavigationRequestUserId(permanentUserId);
  };
  const staffReviewHref = staffAccessQuery.data
    ? applicationHref("/admin")
    : undefined;
  const visibleHeaderDetached =
    !appVisualSystem && headerDetached && !startFlowRoute && !productFlowRoute;
  const homeHeaderJoined =
    onHomePage && !visibleHeaderDetached && !mobileNavigationOpen;
  const detachedHeaderMaxWidth =
    analysisRoute || adminRoute ? "max-w-[90rem]" : "max-w-7xl";
  const headerMotionClassName = visibleHeaderDetached
    ? "duration-[560ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
    : "duration-[360ms] ease-[cubic-bezier(0.4,0,0.2,1)]";
  const glassMotionClassName = visibleHeaderDetached
    ? "duration-[640ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
    : "duration-[360ms] ease-[cubic-bezier(0.4,0,0.2,1)]";

  return (
    <div className="relative flex min-h-svh flex-col bg-background" data-customer-workspace={workspace || undefined} data-completed-review={completedReviewRoute || undefined}>
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
          data-site-header
          data-header-state={visibleHeaderDetached ? "detached" : "integrated"}
          className={cn(
            "absolute top-0 right-0 left-0 transition-[top,left,right] motion-reduce:transition-none",
            onHomePage && "home-header max-lg:transition-none",
            headerMotionClassName,
            visibleHeaderDetached && (onHomePage
              ? "lg:top-3 lg:right-4 lg:left-4"
              : "top-3 right-3 left-3 sm:right-4 sm:left-4"),
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
              "header-glass mx-auto w-full max-w-[100vw] transition-[max-width,border-color,border-radius,box-shadow] motion-reduce:transition-none",
              onHomePage && "max-lg:transition-none",
              homeHeaderJoined ? "overflow-visible" : "overflow-hidden",
              glassMotionClassName,
              visibleHeaderDetached
                ? onHomePage
                  ? "lg:rounded-2xl lg:outline lg:outline-1 lg:-outline-offset-1 lg:outline-white/75"
                  : "rounded-2xl outline outline-1 -outline-offset-1 outline-white/75"
                : homeHeaderJoined
                  ? "home-header-joined"
                  : onHomePage ? "lg:border-b lg:border-line/60" : "border-b border-line/60",
              visibleHeaderDetached && (onHomePage ? "lg:max-w-7xl" : detachedHeaderMaxWidth),
            )}
          >
            <div
              className={cn(
                "mx-auto flex min-h-16 w-full items-center justify-between gap-4 px-5 py-2.5 sm:px-8",
                workspace && "workspace-header-content",
                !appVisualSystem && (analysisRoute || adminRoute)
                  ? "max-w-[90rem] lg:px-10"
                  : "max-w-7xl",
              )}
            >
              <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                <Link
                  to={brandHref}
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

              {workspace ? <CustomerWorkspaceIdentity caseId={workspaceCaseId} /> : null}

              {focusedCaseAccountHeader ? (
                <div className="flex items-center gap-4">
                  {completedReviewRoute ? <div ref={setCompletedReviewActionsHost} /> : null}
                  <AccountControl className="shrink-0" onStaffNavigationRequest={requestStaffNavigation} staffReviewHref={staffReviewHref} />
                </div>
              ) : productFlowRoute ? null : startFlowRoute || adminRoute || appVisualSystem ? (
                <AccountControl
                  className="shrink-0"
                  onStaffNavigationRequest={requestStaffNavigation}
                  signedOutHint={
                    startFlowRoute ? "Already have an account?" : undefined
                  }
                  staffReviewHref={staffReviewHref}
                />
              ) : (
                <>
                  <nav
                    className="hidden shrink-0 items-center gap-1 lg:flex lg:gap-2"
                    aria-label="Primary navigation"
                  >
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
                      publicSessionHint={productionPublicPage ? publicSessionHint : undefined}
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
                      {primaryActionLabel}
                    </Link>}
                  </nav>

                  <div className="flex shrink-0 items-center gap-1.5 lg:hidden">
                    {guestReturn.pending ? (
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
                        {primaryActionLabel}
                      </Link>}
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

            {completedReviewRoute ? (
              <div
                id="completed-review-progress-host"
                className="completed-review-progress-host"
                ref={setCompletedReviewProgressHost}
              />
            ) : null}

            {!appVisualSystem &&
            !startFlowRoute &&
            !adminRoute &&
            !productFlowRoute ? (
              <nav
                id="mobile-navigation"
                className="mobile-navigation lg:hidden"
                aria-label="Mobile navigation"
                data-open={mobileNavigationOpen}
                aria-hidden={!mobileNavigationOpen}
                inert={!mobileNavigationOpen}
              >
                <div className="min-h-0 overflow-hidden">
                  <div className="border-t border-ink/10 bg-transparent px-5">
                    <div className="mx-auto flex w-full max-w-7xl flex-col py-2">
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
                        publicSessionHint={productionPublicPage ? publicSessionHint : undefined}
                        onAction={() => setMobileNavigationOpen(false)}
                        staffReviewHref={staffReviewHref}
                      />
                    </div>
                  </div>
                </div>
              </nav>
            ) : null}
          </div>
        </header>
      </div>
      {completedReviewRoute ? (
        <div
          className="completed-review-navigation-host"
          ref={setCompletedReviewNavigationHost}
        />
      ) : null}
      <main
        id="main-content"
        className="app-entry-main flex flex-1"
        tabIndex={-1}
      >
        <CompletedReviewProgressHostContext.Provider
          value={completedReviewProgressHost}
        >
          <CompletedReviewNavigationHostContext.Provider value={completedReviewNavigationHost}>
            <CompletedReviewActionsHostContext.Provider value={completedReviewActionsHost}>
              {workspace ? <CustomerWorkspace caseId={workspaceCaseId}><Outlet /></CustomerWorkspace> : <Outlet />}
            </CompletedReviewActionsHostContext.Provider>
          </CompletedReviewNavigationHostContext.Provider>
        </CompletedReviewProgressHostContext.Provider>
      </main>
      {workspace ? null : (appVisualSystem && !startFlowRoute && !adminRoute) || productFlowRoute ? (
        <footer className="relative z-10 shrink-0 bg-canvas px-5 py-2 sm:px-8">
          <nav
            aria-label="Legal"
            className="mx-auto flex w-full flex-wrap items-center justify-center gap-x-5 text-xs text-copy"
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
            <a
              href={publicHref("/refund-policy")}
              className="report-action-focus inline-flex min-h-11 items-center rounded-sm hover:text-ink"
            >
              Refund policy
            </a>
          </nav>
        </footer>
      ) : !appVisualSystem && !startFlowRoute && !adminRoute ? (
        <footer className="public-footer relative z-10 shrink-0">
          <div className="public-footer__inner">
            <div className="public-footer__main">
              <div className="public-footer__brand">
                <Link
                  to={brandHref}
                  className="public-footer__brand-link notranslate inline-flex min-h-11 select-none items-center gap-2.5 rounded-sm text-ink"
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
                <p className="public-footer__statement">
                  Clarity for the<br />conversation ahead.
                </p>
                <p className="public-footer__description">
                  Vehicle valuation evidence, explained simply.
                </p>
                {supportEmail ? (
                  <a href={`mailto:${supportEmail}`} className="public-footer__link public-footer__email">
                    {supportEmail}
                  </a>
                ) : null}
              </div>

              <nav aria-label="Footer navigation" className="public-footer__navigation">
                <section>
                  <h2 className="public-footer__heading">Services</h2>
                  <ul>
                    <li><a href={totalLossHref} className={footerLinkClassName}>Total Loss</a></li>
                    <li><a href={diminishedValueHref} className={footerLinkClassName}>Diminished Value</a>
                      {!diminishedValueIntakeAvailable ? <span className="public-footer__service-note">Intake paused</span> : null}
                    </li>
                  </ul>
                </section>
                <section>
                  <h2 className="public-footer__heading">Resources</h2>
                  <ul>
                    <li><Link to="/resources/understanding-your-report" className={footerLinkClassName}>Understanding your report</Link></li>
                    <li><Link to="/resources/valuation-review-checklist" className={footerLinkClassName}>Valuation review checklist</Link></li>
                    <li><Link to="/methodology" className={footerLinkClassName}>Our methodology</Link></li>
                  </ul>
                </section>
                <section>
                  <h2 className="public-footer__heading">Company</h2>
                  <ul>
                    <li><Link to="/about" className={footerLinkClassName}>About Venfour</Link></li>
                    <li><Link to="/contact" className={footerLinkClassName}>Contact</Link></li>
                    <li><Link to="/referral-partners" className={footerLinkClassName}>Referral partners</Link></li>
                  </ul>
                </section>
              </nav>
            </div>
            <div className="public-footer__bottom">
              <p className="public-footer__copyright" data-footer-legal>
                © {new Date().getFullYear()}{" "}
                <span className="notranslate" translate="no">Venfour LLC</span>
                . All rights reserved.
              </p>
              <nav aria-label="Footer legal navigation">
                <ul className="public-footer__legal">
                  <li><Link to="/terms" className={footerLinkClassName}>Terms</Link></li>
                  <li><Link to="/privacy" className={footerLinkClassName}>Privacy</Link></li>
                  <li><Link to="/refund-policy" className={footerLinkClassName}>Refund policy</Link></li>
                  <li><Link to="/cookies" className={footerLinkClassName}>Cookie Policy</Link></li>
                  <li>
                    <button type="button" className={footerLinkClassName} onClick={openPreferences}>
                      Cookie preferences
                    </button>
                  </li>
                </ul>
              </nav>
            </div>
          </div>
        </footer>
      ) : null}
      {!appVisualSystem ? <CookieConsent /> : null}
    </div>
  );
}
