import { Link, isRouteErrorResponse, useRouteError } from "react-router";

import { useDocumentMetadata } from "@/app/document-metadata";
import { Button } from "@/components/ui/button";

export function RouteErrorPage() {
  const error = useRouteError();
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;

  useDocumentMetadata({
    title: isNotFound ? "Page Not Found | Venfour" : "Page Error | Venfour",
    description: isNotFound
      ? "The requested Venfour page could not be found."
      : "Venfour could not display the requested page.",
  });

  return (
    <div className="page-gradient-route-error flex min-h-svh flex-col bg-white">
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center px-5 py-3 sm:px-8">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center rounded-sm text-[1.05rem] font-semibold tracking-[-0.035em] text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-500 focus-visible:ring-offset-2"
            aria-label="Venfour home"
          >
            Venfour
          </Link>
        </div>
      </header>

      <main className="flex flex-1">
        <section
          className="mx-auto flex w-full max-w-6xl flex-col items-start justify-center px-5 py-20 sm:px-8 sm:py-28"
          role="alert"
        >
          <p className="text-xs font-semibold tracking-[0.14em] text-neutral-500 uppercase">
            {isNotFound ? "Page unavailable" : "Unexpected page error"}
          </p>
          <h1 className="mt-4 max-w-2xl text-3xl font-semibold tracking-[-0.035em] text-balance text-neutral-950 sm:text-4xl">
            {isNotFound
              ? "We couldn’t find this page."
              : "We couldn’t display this page."}
          </h1>
          <p className="mt-4 max-w-lg leading-7 text-neutral-600">
            {isNotFound
              ? "The address may be incorrect, or the page may have moved."
              : "An unexpected problem interrupted the page. No technical details have been displayed."}
          </p>
          <Button asChild className="mt-7" size="lg">
            <Link to="/">Return to Venfour</Link>
          </Button>
        </section>
      </main>

      <footer className="site-footer-gradient border-t border-neutral-200 bg-neutral-50/70">
        <div className="mx-auto w-full max-w-6xl px-5 py-6 text-sm text-neutral-600 sm:px-8">
          Independent vehicle-valuation guidance for total-loss claims.
        </div>
      </footer>
    </div>
  );
}
