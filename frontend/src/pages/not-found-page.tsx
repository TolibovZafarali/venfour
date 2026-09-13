import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { ValuationStatus } from "@/components/valuation-status";
import { publicHref } from "@/app/site-boundary";

export function NotFoundPage() {
  return <ValuationStatus heading="Page not found" description="The address may be incorrect, or the page may have moved." eyebrow="Page unavailable">
    <Button asChild><Link to={publicHref()}>Return home</Link></Button>
  </ValuationStatus>;
}
