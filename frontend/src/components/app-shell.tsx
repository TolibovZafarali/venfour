import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useMatch,
  useMatches,
} from "react-router";

import { isPageMetadata, useDocumentMetadata } from "@/app/document-metadata";
import { cn } from "@/lib/utils";
import venfourMark from "../../../assets/brand/venfour-logo-black.svg";

const primaryLinkClassName =
  "inline-flex min-h-11 items-center rounded-sm px-2 text-[0.8125rem] font-medium text-neutral-600 transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2";

const footerLinkClassName =
  "inline-flex min-h-11 items-center rounded-sm text-sm text-neutral-600 transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2";

const mobileLinkClassName =
  "inline-flex min-h-12 items-center border-b border-neutral-200 py-2 text-sm font-medium text-neutral-700 last:border-b-0 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand";

export function AppShell() {
  const analysisRoute = useMatch("/analyses/:runId");
  const location = useLocation();
  const matches = useMatches();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const metadata = [...matches]
    .reverse()
    .map((match) => match.handle)
    .find(isPageMetadata) ?? {
    title: "Venfour",
    description:
      "Understand your vehicle’s value after an accident, review an insurer’s valuation, and explore current support options.",
  };

  useDocumentMetadata(analysisRoute ? null : metadata);

  useEffect(() => {
    if (!location.hash) {
      return;
    }

    const target = document.getElementById(location.hash.slice(1));
    if (typeof target?.scrollIntoView === "function") {
      target.scrollIntoView({ block: "start" });
    }
  }, [location.hash, location.pathname]);

  const onHomePage = location.pathname === "/";
  const howItWorksHref = onHomePage ? "#how-it-works" : "/#how-it-works";
  const startReviewHref = onHomePage ? "#report-review" : "/#report-review";

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <a
        href="#main-content"
        className="fixed top-2 left-2 z-50 inline-flex min-h-11 -translate-y-20 items-center rounded-md bg-brand px-4 text-sm font-medium text-white transition-transform focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 motion-reduce:transition-none"
      >
        Skip to content
      </a>
      <header className="relative z-40 border-b border-neutral-200 bg-white">
        <div
          className={cn(
            "mx-auto flex min-h-16 w-full items-center justify-between gap-4 px-5 py-2.5 sm:px-8",
            analysisRoute ? "max-w-[90rem] lg:px-10" : "max-w-7xl",
          )}
        >
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <Link
              to="/"
              className="inline-flex min-h-11 items-center gap-2.5 rounded-sm text-[1.05rem] font-semibold tracking-[-0.035em] text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
              aria-label="Venfour home"
            >
              <img
                src={venfourMark}
                className="size-[1.15rem]"
                alt=""
                aria-hidden
              />
              <span>Venfour</span>
            </Link>
            {analysisRoute ? (
              <span className="hidden border-l border-neutral-200 pl-4 text-[0.6875rem] font-semibold tracking-[0.12em] text-neutral-500 uppercase sm:block">
                Valuation review
              </span>
            ) : null}
          </div>

          <nav
            className="hidden shrink-0 items-center gap-1 sm:flex sm:gap-2"
            aria-label="Primary navigation"
          >
            <a href={howItWorksHref} className={primaryLinkClassName}>
              How it works
            </a>
            <NavLink
              to="/methodology"
              className={({ isActive }) =>
                cn(
                  primaryLinkClassName,
                  isActive && "text-brand",
                )
              }
            >
              Methodology
            </NavLink>
            <NavLink
              to="/contact"
              className={({ isActive }) =>
                cn(
                  primaryLinkClassName,
                  "hidden md:inline-flex",
                  isActive && "text-brand",
                )
              }
            >
              Contact
            </NavLink>
            <a
              href={startReviewHref}
              className="ml-1 inline-flex min-h-11 items-center rounded-md bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand/35 focus-visible:ring-offset-2"
            >
              Start a valuation review
            </a>
          </nav>

          <div className="flex shrink-0 items-center gap-1.5 sm:hidden">
            <a
              href={startReviewHref}
              className="inline-flex min-h-11 items-center rounded-md bg-brand px-3 text-xs font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand/35 focus-visible:ring-offset-2"
              onClick={() => setMobileNavigationOpen(false)}
            >
              Start review
            </a>
            <button
              type="button"
              className="inline-flex size-11 items-center justify-center rounded-md text-neutral-700 transition-colors hover:bg-neutral-100 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
              aria-expanded={mobileNavigationOpen}
              aria-controls="mobile-navigation"
              aria-label={
                mobileNavigationOpen ? "Close navigation" : "Open navigation"
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
            className="border-t border-neutral-200 bg-white px-5 sm:hidden"
            aria-label="Mobile navigation"
          >
            <div className="mx-auto flex w-full max-w-7xl flex-col py-2">
              <a
                href={howItWorksHref}
                className={mobileLinkClassName}
                onClick={() => setMobileNavigationOpen(false)}
              >
                How it works
              </a>
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
            </div>
          </nav>
        ) : null}
      </header>
      <main id="main-content" className="flex flex-1" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="border-t border-neutral-200 bg-neutral-50/70">
        <div className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 sm:py-9">
          <div className="flex flex-col gap-7 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-sm">
              <Link
                to="/"
                className="inline-flex min-h-11 items-center gap-2 rounded-sm text-sm font-semibold tracking-[-0.02em] text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
              >
                <img
                  src={venfourMark}
                  className="size-4"
                  alt=""
                  aria-hidden
                />
                <span>Venfour</span>
              </Link>
              <p className="mt-2 text-sm leading-6 text-neutral-600">
                Independent vehicle-value guidance after an accident.
              </p>
            </div>

            <nav aria-label="Footer navigation">
              <ul className="flex flex-wrap gap-x-5 gap-y-3">
                <li>
                  <Link to="/methodology" className={footerLinkClassName}>
                    Methodology
                  </Link>
                </li>
                <li>
                  <Link to="/privacy" className={footerLinkClassName}>
                    Privacy
                  </Link>
                </li>
                <li>
                  <Link to="/terms" className={footerLinkClassName}>
                    Terms
                  </Link>
                </li>
                <li>
                  <Link to="/contact" className={footerLinkClassName}>
                    Contact
                  </Link>
                </li>
              </ul>
            </nav>
          </div>
          <p className="mt-7 border-t border-neutral-200 pt-5 text-xs text-neutral-500">
            © {new Date().getFullYear()} Venfour. Informational vehicle-market
            analysis; not legal advice, a formal appraisal, or a guaranteed
            settlement.
          </p>
        </div>
      </footer>
    </div>
  );
}
