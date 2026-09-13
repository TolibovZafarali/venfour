import { ValuationStatus, type ValuationStatusProps } from "@/components/valuation-status";

type AdminRouteStateProps = Omit<ValuationStatusProps, "kind"> & { kind?: ValuationStatusProps["kind"] | "unavailable" };
export function AdminRouteState({ kind, ...props }: AdminRouteStateProps) {
  return <ValuationStatus {...props} kind={kind === "unavailable" ? "secure" : kind} />;
}
