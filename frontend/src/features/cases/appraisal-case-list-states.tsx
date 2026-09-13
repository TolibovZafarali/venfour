import { RefreshCw } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { ValuationStatus } from "@/components/valuation-status";

export function AppraisalCasesLoadingState() {
  return <div aria-label="Loading appraisals" aria-busy="true"><ValuationStatus compact headingLevel="h2" kind="loading" heading="Opening your appraisals" description="Finding your saved reviews." /></div>;
}
export interface AppraisalCasesErrorStateProps {
  readonly description: string;
  readonly heading: string;
  readonly headingId?: string;
  readonly onRetry?: () => void;
  readonly showContactSupport?: boolean;
}
export function AppraisalCasesErrorState({description, heading, onRetry, showContactSupport = false}: AppraisalCasesErrorStateProps) {
  return <ValuationStatus compact headingLevel="h2" kind="error" heading={heading} description={description}>
    {onRetry ? <Button onClick={onRetry}><RefreshCw className="size-4" aria-hidden />Try again</Button> : null}
    {showContactSupport ? <Button asChild variant="outline"><Link to="/contact">Contact support</Link></Button> : null}
  </ValuationStatus>;
}
export interface AppraisalCasesEmptyStateProps { readonly description: string; }
export function AppraisalCasesEmptyState({ description }: AppraisalCasesEmptyStateProps) {
  return <ValuationStatus compact headingLevel="h2" heading="No appraisals yet" description={description} />;
}
