import type { TotalLossIntakeMode } from "@/features/total-loss/types";
import type { TotalLossPublishedReport } from "../contracts";
import { dateLabel, disclosureLabel, displayed, numeric, reportText, roleLabel, temporalLabel } from "../report-format";

type ReportProps = { readonly report: TotalLossPublishedReport; readonly open?: boolean };

export function MethodologyDisclosure({ report, intakeMode = "report" }: ReportProps & { readonly intakeMode?: TotalLossIntakeMode }) {
  const context = report.marketEvidence.evidenceDateContext;
  return (
    <details>
      <summary>Evidence dates and methodology</summary>
      <dl>
        <dt>Date of loss</dt><dd>{dateLabel(context.lossDate)}</dd>
        <dt>Current listings collected</dt><dd>{dateLabel(context.currentObservedDate)}</dd>
        <dt>Historical evidence date</dt><dd>{dateLabel(context.historicalEvidenceDate)}</dd>
      </dl>
      {report.marketEvidence.primary?.description ? <p>{reportText(report.marketEvidence.primary.description)}</p> : null}
      {report.marketEvidence.secondary?.description ? <p>{reportText(report.marketEvidence.secondary.description)}</p> : null}
      {report.marketEvidence.methodologyStatement ? <p>{reportText(report.marketEvidence.methodologyStatement)}</p> : null}
      {intakeMode === "report" && report.insurerEvidence.methodologyStatement ? <p>{reportText(report.insurerEvidence.methodologyStatement)}</p> : null}
      {intakeMode === "report" && report.insurerEvidence.adjustmentContext ? <p>{reportText(report.insurerEvidence.adjustmentContext)}</p> : null}
      {report.conclusion.preliminaryComparison?.summary ? <p>{reportText(report.conclusion.preliminaryComparison.summary)}</p> : null}
      <p>The evidence package contains the complete methodology, limitations, and technical evidence.</p>
    </details>
  );
}

export function InsurerEvidenceDetails({ report, open }: ReportProps) {
  const rows = report.insurerEvidence.comparables;
  return (
    <details open={open || undefined}>
      <summary>Insurer comparable details</summary>
      <p>These are the values and adjustments disclosed in the reviewed report. Missing details do not establish that an adjustment was improper.</p>
      <p>Reported contribution is the insurer’s contribution percentage. Venfour has not assigned professional accepted, challenged, or excluded weights.</p>
      {rows.length ? (
        <div className="evidence-table" tabIndex={0} role="region" aria-label="Insurer comparable table">
          <table>
            <caption>Insurer comparables</caption>
            <thead><tr>
              <th scope="col">Vehicle</th><th scope="col">Mileage</th>
              <th scope="col">Advertised price</th><th scope="col">Adjusted value</th>
              <th scope="col">Net adjustment</th><th scope="col">Disclosure status</th>
              <th scope="col">Condition adjustment</th><th scope="col">Mileage adjustment</th>
              <th scope="col">Options adjustment</th><th scope="col">Package adjustment</th>
              <th scope="col">Reported contribution</th>
            </tr></thead>
            <tbody>{rows.map((row, index) => (
              <tr key={`${index}:${row.vehicle}`}>
                <th scope="row">{displayed(row.vehicle, `Insurer comparable ${index + 1}`)}</th>
                <td>{numeric(row.mileage, " mi")}</td><td>{displayed(row.advertisedPrice)}</td>
                <td>{displayed(row.adjustedValue)}</td><td>{displayed(row.netAdjustment, "Not disclosed")}</td>
                <td>{disclosureLabel(row.adjustmentDisclosure)}</td>
                <td>{displayed(row.adjustments.condition, "Not disclosed")}</td>
                <td>{displayed(row.adjustments.mileage, "Not disclosed")}</td>
                <td>{displayed(row.adjustments.options, "Not disclosed")}</td>
                <td>{displayed(row.adjustments.package, "Not disclosed")}</td>
                <td>{numeric(row.contributionPercent, "%")}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p>No insurer comparable rows were available in the reviewed report.</p>}
    </details>
  );
}

export function MarketEvidenceDetails({ report, open }: ReportProps) {
  const rows = report.marketEvidence.comparables;
  return (
    <details open={open || undefined}>
      <summary>Selected market listing details</summary>
      <p>All selected rows are shown in the order supplied by the completed review.</p>
      {rows.length ? (
        <div className="evidence-table" tabIndex={0} role="region" aria-label="Selected market listing table">
          <table>
            <caption>Selected market listings</caption>
            <thead><tr>
              <th scope="col">Vehicle</th><th scope="col">Mileage</th>
              <th scope="col">Advertised price</th><th scope="col">Distance</th>
              <th scope="col">Dealer</th><th scope="col">Location</th>
              <th scope="col">Evidence date</th><th scope="col">Listing context</th><th scope="col">Evidence role</th>
            </tr></thead>
            <tbody>{rows.map((row, index) => (
              <tr key={`${index}:${row.vehicle}`}>
                <th scope="row">{displayed(row.vehicle, `Selected listing ${index + 1}`)}</th>
                <td>{numeric(row.mileage, " mi")}</td><td>{displayed(row.advertisedPrice)}</td>
                <td>{numeric(row.distanceMiles, " mi")}</td><td>{displayed(row.dealer)}</td>
                <td>{displayed(row.location)}</td><td>{dateLabel(row.evidenceDate)}</td>
                <td>{temporalLabel(row.temporalBasis)}</td><td>{roleLabel(row.role)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <p>No selected market listing rows were provided.</p>}
    </details>
  );
}
