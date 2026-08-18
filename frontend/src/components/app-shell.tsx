import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useMatch,
  useMatches,
} from "react-router";

import { isPageMetadata, useDocumentMetadata } from "@/app/document-metadata";
import { supportEmail } from "@/config/support";
import { cn } from "@/lib/utils";
import venfourMark from "../../../assets/brand/venfour-logo-black.svg";

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
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const mobileNavigationButtonRef = useRef<HTMLButtonElement>(null);
  const metadata = [...matches]
    .reverse()
    .map((match) => match.handle)
    .find(isPageMetadata) ?? {
    title: "Vehicle Value After an Accident | Venfour",
    description:
      "Review a total-loss valuation, check your vehicle’s market value, or request diminished-value help after an accident.",
  };

  useDocumentMetadata(analysisRoute ? null : metadata);

  useEffect(() => {
    if (!location.hash) {
      return;
    }

    const target = document.getElementById(location.hash.slice(1));
    if (typeof target?.scrollIntoView === "function") {
      target.scrollIntoView({ block: "start" });
      target.focus({ preventScroll: true });
    }
  }, [location.hash, location.pathname]);

  const onHomePage = location.pathname === "/";
  const howItWorksHref = onHomePage ? "#how-it-works" : "/#how-it-works";
  const servicesHref = onHomePage ? "#services" : "/#services";

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <a
        href="#main-content"
        className="fixed top-2 left-2 z-50 inline-flex min-h-11 -translate-y-20 items-center rounded-md bg-brand px-4 text-sm font-medium text-white transition-transform focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 motion-reduce:transition-none"
      >
        Skip to content
      </a>
      <header
        className="relative z-40 border-b border-line bg-white"
        onKeyDown={(event) => {
          if (mobileNavigationOpen && event.key === "Escape") {
            setMobileNavigationOpen(false);
            mobileNavigationButtonRef.current?.focus();
          }
        }}
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
              className="inline-flex min-h-11 items-center gap-2.5 rounded-sm text-[1.05rem] font-semibold tracking-[-0.035em] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
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
              <span className="hidden border-l border-line pl-4 text-[0.6875rem] font-semibold tracking-[0.12em] text-copy uppercase sm:block">
                Valuation review
              </span>
            ) : null}
          </div>

          <nav
            className="hidden shrink-0 items-center gap-1 lg:flex lg:gap-2"
            aria-label="Primary navigation"
          >
            <a href={servicesHref} className={primaryLinkClassName}>
              Services
            </a>
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
                  isActive && "text-brand",
                )
              }
            >
              Contact
            </NavLink>
            <a
              href={servicesHref}
              className="ml-1 inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none"
            >
              Get started
            </a>
          </nav>

          <div className="flex shrink-0 items-center gap-1.5 lg:hidden">
            <a
              href={servicesHref}
              className="inline-flex min-h-11 items-center rounded-lg bg-brand px-3 text-xs font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none"
              onClick={() => setMobileNavigationOpen(false)}
            >
              Get started
            </a>
            <button
              ref={mobileNavigationButtonRef}
              type="button"
              className="inline-flex size-11 items-center justify-center rounded-lg text-copy transition-colors hover:bg-surface hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none"
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
            className="border-t border-line bg-white px-5 lg:hidden"
            aria-label="Mobile navigation"
          >
            <div className="mx-auto flex w-full max-w-7xl flex-col py-2">
              <a
                href={servicesHref}
                className={mobileLinkClassName}
                onClick={() => setMobileNavigationOpen(false)}
              >
                Services
              </a>
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
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 sm:py-9">
          <div className="flex flex-col gap-7 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-sm">
              <Link
                to="/"
                className="inline-flex min-h-11 items-center gap-2 rounded-sm text-sm font-semibold tracking-[-0.02em] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
              >
                <img
                  src={venfourMark}
                  className="size-4"
                  alt=""
                  aria-hidden
                />
                <span>Venfour</span>
              </Link>
              <p className="mt-2 text-sm leading-6 text-copy">
                Independent vehicle-value guidance after an accident.
              </p>
              {supportEmail ? (
                <a
                  href={`mailto:${supportEmail}`}
                  className={`${footerLinkClassName} mt-1`}
                >
                  {supportEmail}
                </a>
              ) : null}
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
          <p className="mt-7 border-t border-line pt-5 text-xs text-copy">
            © {new Date().getFullYear()} Venfour. Informational vehicle-market
            analysis; not legal advice, a formal appraisal, or a guaranteed
            settlement.
          </p>
        </div>
      </footer>
    </div>
  );
}
