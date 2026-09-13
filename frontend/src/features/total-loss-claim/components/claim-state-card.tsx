import { ValuationStatus, type ValuationStatusProps } from "@/components/valuation-status";

export function ClaimStateCard(props: ValuationStatusProps) {
  return <ValuationStatus eyebrow="Secure claim access" {...props} />;
}
