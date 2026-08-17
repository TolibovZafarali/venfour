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

const primaryLinkClassName =
  "inline-flex min-h-11 items-center rounded-md px-2 text-[0.8125rem] font-medium text-neutral-600 transition-colors hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2";

const footerLinkClassName =
  "inline-flex min-h-11 items-center rounded-sm text-sm text-neutral-600 transition-colors hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2";

export function AppShell() {
  const analysisRoute = useMatch("/analyses/:runId");
  const location = useLocation();
  const matches = useMatches();
  const metadata = [...matches]
    .reverse()
    .map((match) => match.handle)
    .find(isPageMetadata) ?? {
    title: "Venfour",
    description:
      "Independent review of CCC vehicle valuations and relevant market evidence.",
  };

  useDocumentMetadata(analysisRoute ? null : metadata);

  const showStartLink = location.pathname !== "/";

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <a
        href="#main-content"
        className="fixed top-2 left-2 z-50 inline-flex min-h-11 -translate-y-20 items-center rounded-md bg-neutral-950 px-4 text-sm font-medium text-white transition-transform focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-neutral-500 focus:ring-offset-2 motion-reduce:transition-none"
      >
        Skip to content
      </a>
      <header className="border-b border-neutral-200 bg-white">
        <div
          className={cn(
            "mx-auto flex min-h-16 w-full items-center justify-between gap-5 px-5 py-3 sm:px-8",
            analysisRoute ? "max-w-[90rem] lg:px-10" : "max-w-6xl",
          )}
        >
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <Link
              to="/"
              className="inline-flex min-h-11 items-center rounded-sm text-[1.05rem] font-semibold tracking-[-0.035em] text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2"
              aria-label="Venfour home"
            >
              Venfour
            </Link>
            {analysisRoute ? (
              <span className="hidden border-l border-neutral-200 pl-4 text-[0.6875rem] font-semibold tracking-[0.12em] text-neutral-500 uppercase sm:block">
                Valuation review
              </span>
            ) : null}
          </div>

          <nav
            className={cn(
              "shrink-0 items-center gap-1 sm:gap-3",
              showStartLink ? "flex" : "hidden sm:flex",
            )}
            aria-label="Primary navigation"
          >
            <NavLink
              to="/methodology"
              className={({ isActive }) =>
                cn(
                  primaryLinkClassName,
                  "hidden sm:inline-flex",
                  isActive && "text-neutral-950",
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
                  isActive && "text-neutral-950",
                )
              }
            >
              Contact
            </NavLink>
            {showStartLink ? (
              <Link
                to="/"
                className="inline-flex min-h-11 items-center rounded-lg border border-neutral-300 px-3 text-[0.8125rem] font-medium text-neutral-900 transition-colors hover:border-neutral-400 hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2 sm:px-4"
              >
                Start analysis
              </Link>
            ) : null}
          </nav>
        </div>
      </header>
      <main id="main-content" className="flex flex-1" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="border-t border-neutral-200 bg-neutral-50/70">
        <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-9">
          <div className="flex flex-col gap-7 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-sm">
              <Link
                to="/"
                className="inline-flex min-h-11 items-center rounded-sm text-sm font-semibold tracking-[-0.02em] text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2"
              >
                Venfour
              </Link>
              <p className="mt-2 text-sm leading-6 text-neutral-600">
                Independent vehicle-valuation guidance for total-loss claims.
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
