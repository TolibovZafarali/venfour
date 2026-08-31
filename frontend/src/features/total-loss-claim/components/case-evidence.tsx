import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import type { TotalLossIntakeMode } from "@/features/total-loss/types";
import type { TotalLossPublishedReport } from "../contracts";
import { dateLabel, disclosureLabel, displayed, moneyLabel, numeric, reportText, roleLabel, temporalLabel } from "../report-format";
import "./completed-evidence.css";

type ReportProps = { readonly report: TotalLossPublishedReport; readonly open?: boolean };

function EvidenceDisclosure({
  children,
  label,
  open,
  methodology = false,
}: {
  readonly children: ReactNode;
  readonly label: string;
  readonly open?: boolean;
  readonly methodology?: boolean;
}) {
  return (
    <details className={`completed-evidence${methodology ? " completed-evidence--methodology" : ""}`} data-review-entrance="supporting" open={open || undefined}>
      <summary>
        <span>{label}</span>
        <ChevronDown aria-hidden="true" size={19} strokeWidth={1.7} />
      </summary>
      <div className="completed-evidence__body">{children}</div>
    </details>
  );
}

function EvidenceCell({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return <td role="cell" data-label={label}>{children}</td>;
}

export function MethodologyDisclosure({ report, intakeMode = "report" }: ReportProps & { readonly intakeMode?: TotalLossIntakeMode }) {
  const context = report.marketEvidence.evidenceDateContext;
  return (
    <EvidenceDisclosure label="Evidence dates and methodology" methodology>
      <dl className="completed-evidence__dates">
        <div><dt>Date of loss</dt><dd>{dateLabel(context.lossDate)}</dd></div>
        <div><dt>Current listings collected</dt><dd>{dateLabel(context.currentObservedDate)}</dd></div>
        <div><dt>Historical evidence date</dt><dd>{dateLabel(context.historicalEvidenceDate)}</dd></div>
      </dl>
      <div className="completed-evidence__methodology-copy">
        {report.marketEvidence.primary?.description ? <p>{reportText(report.marketEvidence.primary.description)}</p> : null}
        {report.marketEvidence.secondary?.description ? <p>{reportText(report.marketEvidence.secondary.description)}</p> : null}
        {report.marketEvidence.methodologyStatement ? <p>{reportText(report.marketEvidence.methodologyStatement)}</p> : null}
        {intakeMode === "report" && report.insurerEvidence.methodologyStatement ? <p>{reportText(report.insurerEvidence.methodologyStatement)}</p> : null}
        {intakeMode === "report" && report.insurerEvidence.adjustmentContext ? <p>{reportText(report.insurerEvidence.adjustmentContext)}</p> : null}
        {report.conclusion.preliminaryComparison?.summary ? <p>{reportText(report.conclusion.preliminaryComparison.summary)}</p> : null}
        <p>The evidence package contains the complete methodology, limitations, and technical evidence.</p>
      </div>
    </EvidenceDisclosure>
  );
}

export function InsurerEvidenceDetails({ report, open }: ReportProps) {
  const rows = report.insurerEvidence.comparables;
  return (
    <EvidenceDisclosure label="Insurer comparable details" open={open}>
      <div className="completed-evidence__introduction">
        <p>These are the values and adjustments disclosed in your insurer’s report. Missing details do not mean an adjustment was improper.</p>
        <p>Reported contribution shows the percentage the insurer assigned to a comparable. Venfour has not assigned its own accepted, challenged, or excluded weights.</p>
      </div>
      {(["advertisedPrices", "adjustedValues"] as const).map((kind) => {
        const summary = report.insurerEvidence.summary[kind];
        return summary && summary.count > 1 && summary.low?.amountMinorUnits != null && summary.high?.amountMinorUnits != null && displayed(summary.low.formatted, "") && displayed(summary.high.formatted, "") ? <p key={kind}>{kind === "advertisedPrices" ? "Disclosed advertised prices" : "Disclosed adjusted values"} ranged from {moneyLabel(summary.low)} to {moneyLabel(summary.high)}.</p> : null;
      })}
      {rows.length ? (
        <div className="evidence-table completed-evidence__table" tabIndex={0} role="region" aria-label="Insurer comparable table">
          <table role="table">
            <caption>Insurer comparables</caption>
            <thead role="rowgroup"><tr role="row">
              <th scope="col">Vehicle</th><th scope="col">Mileage</th>
              <th scope="col">Advertised price</th><th scope="col">Adjusted value</th>
              <th scope="col">Net adjustment</th><th scope="col">Disclosure status</th>
              <th scope="col">Condition adjustment</th><th scope="col">Mileage adjustment</th>
              <th scope="col">Options adjustment</th><th scope="col">Package adjustment</th>
              <th scope="col">Reported contribution</th>
            </tr></thead>
            <tbody role="rowgroup">{rows.map((row, index) => (
              <tr role="row" key={`${index}:${row.vehicle}`}>
                <th role="rowheader" scope="row">{displayed(row.vehicle, `Insurer comparable ${index + 1}`)}</th>
                <EvidenceCell label="Mileage">{numeric(row.mileage, " mi")}</EvidenceCell>
                <EvidenceCell label="Advertised price">{displayed(row.advertisedPrice)}</EvidenceCell>
                <EvidenceCell label="Adjusted value">{displayed(row.adjustedValue)}</EvidenceCell>
                <EvidenceCell label="Net adjustment">{displayed(row.netAdjustment, "Not disclosed")}</EvidenceCell>
                <EvidenceCell label="Disclosure status">{disclosureLabel(row.adjustmentDisclosure)}</EvidenceCell>
                <EvidenceCell label="Condition adjustment">{displayed(row.adjustments.condition, "Not disclosed")}</EvidenceCell>
                <EvidenceCell label="Mileage adjustment">{displayed(row.adjustments.mileage, "Not disclosed")}</EvidenceCell>
                <EvidenceCell label="Options adjustment">{displayed(row.adjustments.options, "Not disclosed")}</EvidenceCell>
                <EvidenceCell label="Package adjustment">{displayed(row.adjustments.package, "Not disclosed")}</EvidenceCell>
                <EvidenceCell label="Reported contribution">{numeric(row.contributionPercent, "%")}</EvidenceCell>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="completed-evidence__empty">No insurer comparables were available in the report.</p>}
    </EvidenceDisclosure>
  );
}

export function MarketEvidenceDetails({ report, open }: ReportProps) {
  const rows = report.marketEvidence.comparables;
  return (
    <EvidenceDisclosure label="See selected market listings" open={open}>
      <p className="completed-evidence__introduction">Explore the selected listings, including mileage, dealer, location, and dates.</p>
      {rows.length ? (
        <div className="evidence-table completed-evidence__table" tabIndex={0} role="region" aria-label="Selected market listing table">
          <table role="table">
            <caption>Selected market listings</caption>
            <thead role="rowgroup"><tr role="row">
              <th scope="col">Vehicle</th><th scope="col">Mileage</th>
              <th scope="col">Advertised price</th><th scope="col">Distance</th>
              <th scope="col">Dealer</th><th scope="col">Location</th>
              <th scope="col">Evidence date</th><th scope="col">Listing context</th><th scope="col">Evidence role</th>
            </tr></thead>
            <tbody role="rowgroup">{rows.map((row, index) => (
              <tr role="row" key={`${index}:${row.vehicle}`}>
                <th role="rowheader" scope="row">{displayed(row.vehicle, `Selected listing ${index + 1}`)}</th>
                <EvidenceCell label="Mileage">{numeric(row.mileage, " mi")}</EvidenceCell>
                <EvidenceCell label="Advertised price">{displayed(row.advertisedPrice)}</EvidenceCell>
                <EvidenceCell label="Distance">{numeric(row.distanceMiles, " mi")}</EvidenceCell>
                <EvidenceCell label="Dealer">{displayed(row.dealer)}</EvidenceCell>
                <EvidenceCell label="Location">{displayed(row.location)}</EvidenceCell>
                <EvidenceCell label="Evidence date">{dateLabel(row.evidenceDate)}</EvidenceCell>
                <EvidenceCell label="Listing context">{temporalLabel(row.temporalBasis)}</EvidenceCell>
                <EvidenceCell label="Evidence role">{roleLabel(row.role)}</EvidenceCell>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p className="completed-evidence__empty">No comparable market listings were available.</p>}
    </EvidenceDisclosure>
  );
}
