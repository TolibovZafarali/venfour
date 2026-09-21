import { ValuationStatus } from "@/components/valuation-status";
import { publicHref } from "@/app/site-boundary";
import venfourMark from "../../../assets/brand/venfour-mark.svg";
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

  return <div className="min-h-svh bg-canvas">
    <header data-site-header className="mx-auto flex min-h-16 max-w-7xl items-center px-5 sm:px-8"><Link to={publicHref()} className="inline-flex min-h-11 items-center gap-2 text-xl font-semibold tracking-tight" aria-label="Venfour home"><img src={venfourMark} className="size-7" alt="" />Venfour</Link></header>
    <main><ValuationStatus kind="error" heading={isNotFound ? "We couldn’t find this page." : "We couldn’t display this page."} description={isNotFound ? "The address may be incorrect, or the page may have moved." : "Something interrupted this page. Try opening it again."}>
      {!isNotFound ? <Button onClick={() => window.location.reload()}>Try again</Button> : null}
      <Button asChild variant={isNotFound ? "default" : "outline"}><Link to={publicHref()}>Return to Venfour</Link></Button>
    </ValuationStatus></main>
  </div>;
}
