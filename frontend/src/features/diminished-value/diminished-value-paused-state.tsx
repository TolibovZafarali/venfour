import { ArrowRight } from "lucide-react";
import { Link } from "react-router";
import { ValuationStatus } from "@/components/valuation-status";
import { primaryFlowButtonClassName } from "@/features/total-loss/intake-fields";

export function DiminishedValuePausedState() {
  return <ValuationStatus headingLevel="h2" heading="Diminished Value intake is not open yet" eyebrow="Service update" description="Diminished Value remains part of Venfour. We’re completing the Total Loss experience before opening this service to customers.">
    <Link className={primaryFlowButtonClassName} to="/start?service=total-loss">Start a Total Loss review<ArrowRight className="size-4" aria-hidden /></Link>
  </ValuationStatus>;
}
