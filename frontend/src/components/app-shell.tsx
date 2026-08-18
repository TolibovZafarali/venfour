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
import { cn } from "@/lib/utils";
import venfourMark from "../../../assets/brand/venfour-mark.svg";

const primaryLinkClassName =
  "inline-flex min-h-11 items-center rounded-sm px-2 text-[0.8125rem] font-medium text-copy transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none";

const footerLinkClassName =
  "inline-flex min-h-11 items-center rounded-sm text-sm text-copy transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none";

const mobileLinkClassName =
  "inline-flex min-h-12 items-center border-b border-line py-2 text-sm font-medium text-ink last:border-b-0 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand";

export function AppShell() {
  const analysisRoute = useMatch("/analyses/:runId");
  const location = useLocation();
  const matches = useMatches();
  const navigate = useNavigate();
  const [headerDetached, setHeaderDetached] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const headerSentinelRef = useRef<HTMLSpanElement>(null);
  const mobileNavigationButtonRef = useRef<HTMLButtonElement>(null);
  const previousLocationKeyRef = useRef(location.key);
  const clearingSectionHashRef = useRef(false);
  const metadata = [...matches]
    .reverse()
    .map((match) => match.handle)
    .find(isPageMetadata) ?? {
    title: "Vehicle Appraisals After an Accident | Venfour",
    description:
      "Start a total-loss appraisal online or learn how a diminished value appraisal documents value lost after repairs.",
  };

  useDocumentMetadata(analysisRoute ? null : metadata);

  useEffect(() => {
    const isNavigation = previousLocationKeyRef.current !== location.key;
    previousLocationKeyRef.current = location.key;

    if (!location.hash) {
      if (clearingSectionHashRef.current) {
        clearingSectionHashRef.current = false;
        return;
      }

      if (isNavigation && location.pathname === "/") {
        const resetScrollTimeout = window.setTimeout(() => {
          window.scrollTo({ top: 0, left: 0, behavior: "auto" });
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
    location.hash,
    location.key,
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
  const totalLossHref = onHomePage ? "#total-loss" : "/#total-loss";
  const diminishedValueHref = onHomePage
    ? "#diminished-value"
    : "/#diminished-value";
  const howItWorksHref = onHomePage ? "#how-it-works" : "/#how-it-works";
  const primaryActionHref = "/total-loss-review";
  const detachedHeaderMaxWidth = analysisRoute
    ? "max-w-[90rem]"
    : "max-w-7xl";

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
          data-header-state={headerDetached ? "detached" : "integrated"}
          className={cn(
            "absolute top-0 right-0 left-0 transition-[top,left,right] duration-200 ease-out motion-reduce:transition-none",
            headerDetached && "top-3 right-3 left-3 sm:right-4 sm:left-4",
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
              "mx-auto w-full bg-white transition-[border-color,border-radius,box-shadow] duration-200 ease-out motion-reduce:transition-none",
              headerDetached
                ? "rounded-xl border border-line shadow-[0_10px_30px_rgba(11,31,51,0.10)]"
                : "border-b border-line/80",
              headerDetached && detachedHeaderMaxWidth,
            )}
          >
            <div
              className={cn(
                "mx-auto flex min-h-16 w-full items-center justify-between gap-4 px-5 py-2.5 sm:px-8",
                analysisRoute ? "max-w-[90rem] lg:px-10" : "max-w-7xl",
              )}
            >
              <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                <Link
                  to="/"
                  className="inline-flex min-h-11 items-center gap-2.5 rounded-sm font-brand text-[1.1rem] font-semibold tracking-[0.1em] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                  aria-label="Venfour home"
                >
                  <img
                    src={venfourMark}
                    className="size-7"
                    alt=""
                    aria-hidden
                    data-brand-logo="venfour"
                  />
                  <span>VENFOUR</span>
                </Link>
                {analysisRoute ? (
                  <span className="hidden border-l border-line pl-4 text-[0.6875rem] font-semibold tracking-[0.12em] text-copy uppercase sm:block">
                    Valuation review
                  </span>
                ) : null}
              </div>

              <nav
                className="hidden shrink-0 items-center gap-1 lg:flex lg:gap-2"
                aria-label="Primary navigation"
              >
                <a href={totalLossHref} className={primaryLinkClassName}>
                  Total Loss
                </a>
                <a href={diminishedValueHref} className={primaryLinkClassName}>
                  Diminished Value
                </a>
                <a href={howItWorksHref} className={primaryLinkClassName}>
                  How It Works
                </a>
                <a
                  href={primaryActionHref}
                  className="ml-1 inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none"
                >
                  Get Started
                </a>
              </nav>

              <div className="flex shrink-0 items-center gap-1.5 lg:hidden">
                <a
                  href={primaryActionHref}
                  className="inline-flex min-h-11 items-center rounded-lg bg-brand px-3 text-xs font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none"
                  onClick={() => setMobileNavigationOpen(false)}
                >
                  Get Started
                </a>
                <button
                  ref={mobileNavigationButtonRef}
                  type="button"
                  className="inline-flex size-11 items-center justify-center rounded-lg text-copy transition-colors hover:bg-surface hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none"
                  aria-expanded={mobileNavigationOpen}
                  aria-controls="mobile-navigation"
                  aria-label={
                    mobileNavigationOpen
                      ? "Close navigation"
                      : "Open navigation"
                  }
                  onClick={() => setMobileNavigationOpen((open) => !open)}
                >
                  {mobileNavigationOpen ? (
                    <X className="size-5" aria-hidden />
                  ) : (
                    <Menu className="size-5" aria-hidden />
                  )}
                </button>
              </div>
            </div>

            {mobileNavigationOpen ? (
              <nav
                id="mobile-navigation"
                className={cn(
                  "border-t border-line bg-white px-5 lg:hidden",
                  headerDetached && "rounded-b-xl",
                )}
                aria-label="Mobile navigation"
              >
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
                </div>
              </nav>
            ) : null}
          </div>
        </header>
      </div>
      <main id="main-content" className="flex flex-1" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto w-full max-w-7xl px-5 py-6 sm:px-8 sm:py-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-5">
              <Link
                to="/"
                className="inline-flex min-h-11 items-center gap-2.5 rounded-sm font-brand text-sm font-semibold tracking-[0.1em] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
              >
                <img
                  src={venfourMark}
                  className="size-6"
                  alt=""
                  aria-hidden
                  data-brand-logo="venfour"
                />
                <span>VENFOUR</span>
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

            <nav aria-label="Footer navigation">
              <ul className="flex flex-wrap gap-x-5 gap-y-3">
                <li>
                  <a href={totalLossHref} className={footerLinkClassName}>
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
              </ul>
            </nav>
          </div>
          <p className="mt-4 border-t border-line pt-4 text-xs text-copy">
            © {new Date().getFullYear()} VENFOUR. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
