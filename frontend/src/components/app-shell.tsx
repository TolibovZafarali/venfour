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
  const [headerDetached, setHeaderDetached] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const headerSentinelRef = useRef<HTMLSpanElement>(null);
  const mobileNavigationButtonRef = useRef<HTMLButtonElement>(null);
  const metadata = [...matches]
    .reverse()
    .map((match) => match.handle)
    .find(isPageMetadata) ?? {
    title: "Check Your Car’s Value After an Accident | Venfour",
    description:
      "Check an insurance report, your car’s market value, or value lost after repairs with Venfour.",
  };

  useDocumentMetadata(analysisRoute ? null : metadata);

  useEffect(() => {
    if (!location.hash) {
      return;
    }

    const target = document.getElementById(location.hash.slice(1));
    if (!target) {
      return;
    }

    target.scrollIntoView?.({ block: "start" });
    target.focus({ preventScroll: true });
  }, [location.hash, location.pathname]);

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
  const servicesHref = onHomePage ? "#services" : "/#services";
  const primaryActionHref = onHomePage ? "#services" : "/total-loss-review";
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
                ? "rounded-xl border border-line shadow-[0_10px_30px_rgba(16,24,40,0.12)]"
                : "border-b border-line",
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
                  className="inline-flex min-h-11 items-center gap-2.5 rounded-sm text-[1.05rem] font-semibold tracking-[-0.035em] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                  aria-label="Venfour home"
                >
                  <img
                    src={venfourMark}
                    className="size-6"
                    alt=""
                    aria-hidden
                    data-brand-logo="venfour"
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
                <NavLink
                  to="/methodology"
                  className={({ isActive }) =>
                    cn(primaryLinkClassName, isActive && "text-brand")
                  }
                >
                  Methodology
                </NavLink>
                <NavLink
                  to="/contact"
                  className={({ isActive }) =>
                    cn(primaryLinkClassName, isActive && "text-brand")
                  }
                >
                  Contact
                </NavLink>
                <a
                  href={primaryActionHref}
                  className="ml-1 inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-[0.8125rem] font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none"
                >
                  Get started
                </a>
              </nav>

              <div className="flex shrink-0 items-center gap-1.5 lg:hidden">
                <a
                  href={primaryActionHref}
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
                    href={servicesHref}
                    className={mobileLinkClassName}
                    onClick={() => setMobileNavigationOpen(false)}
                  >
                    Services
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
                className="inline-flex min-h-11 items-center gap-2 rounded-sm text-sm font-semibold tracking-[-0.02em] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
              >
                <img
                  src={venfourMark}
                  className="size-5"
                  alt=""
                  aria-hidden
                  data-brand-logo="venfour"
                />
                <span>Venfour</span>
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
          <p className="mt-4 border-t border-line pt-4 text-xs text-copy">
            © {new Date().getFullYear()} Venfour.
          </p>
        </div>
      </footer>
    </div>
  );
}
