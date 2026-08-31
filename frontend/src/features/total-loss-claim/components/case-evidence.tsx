import type { TotalLossPublishedReport } from "../contracts";
import {
  dateLabel,
  disclosureLabel,
  displayed,
  numeric,
  reportText,
  roleLabel,
  temporalLabel,
} from "../report-format";

type ReportProps = { readonly report: TotalLossPublishedReport };

export function MethodologyDisclosure({ report }: ReportProps) {
  const context = report.marketEvidence.evidenceDateContext;
  return (
    <details>
      <summary>Methodology and limitations</summary>
      <dl>
        <dt>Date of loss</dt>
        <dd>{dateLabel(context.lossDate)}</dd>
        <dt>Current listings collected</dt>
        <dd>{dateLabel(context.currentObservedDate)}</dd>
        <dt>Historical evidence date</dt>
        <dd>
          {context.historicalEvidenceDate
            ? dateLabel(context.historicalEvidenceDate)
            : "No historical date provided"}
        </dd>
      </dl>
      {report.marketEvidence.primary?.description ? (
        <p>{reportText(report.marketEvidence.primary.description)}</p>
      ) : null}
      {report.marketEvidence.secondary?.description ? (
        <p>{reportText(report.marketEvidence.secondary.description)}</p>
      ) : null}
      <p>
        Advertised listings are not completed sales. Current listings describe
        the market when collected, not necessarily the market on the date of
        loss.
      </p>
      {report.marketEvidence.methodologyStatement ? (
        <p>{reportText(report.marketEvidence.methodologyStatement)}</p>
      ) : null}
      {report.insurerEvidence.methodologyStatement ? (
        <p>{reportText(report.insurerEvidence.methodologyStatement)}</p>
      ) : null}
      {report.insurerEvidence.adjustmentContext ? (
        <p>{reportText(report.insurerEvidence.adjustmentContext)}</p>
      ) : null}
      {report.conclusion.preliminaryComparison?.summary ? (
        <p>{reportText(report.conclusion.preliminaryComparison.summary)}</p>
      ) : null}
      {report.conclusion.limitations.length ? (
        <ul>
          {report.conclusion.limitations.map((limitation, index) => (
            <li key={`${index}:${limitation}`}>{reportText(limitation)}</li>
          ))}
        </ul>
      ) : null}
      <p>
        The evidence package contains the complete methodology and technical
        evidence. Advertised prices do not establish a guaranteed settlement
        value.
      </p>
    </details>
  );
}

export function CaseEvidence({ report }: ReportProps) {
  const insurer = report.insurerEvidence;
  const market = report.marketEvidence;
  return (
    <section aria-labelledby="completed-evidence-heading">
      <h2 id="completed-evidence-heading">Evidence</h2>
      <section aria-labelledby="insurer-evidence-heading" id="insurer" tabIndex={-1}>
        <h3 id="insurer-evidence-heading">Insurer comparables</h3>
        <p>
          The insurer used {insurer.comparableCount.toLocaleString("en-US")} comparable
          vehicles. Detailed adjustment information was available for{" "}
          {insurer.summary.fullyDisclosedAdjustmentCount.toLocaleString("en-US")}.
        </p>
        {insurer.comparables.length ? (
          <div className="overflow-x-auto" tabIndex={0}>
            <table>
              <caption className="sr-only">Insurer comparables</caption>
              <thead>
                <tr>
                  <th scope="col">Vehicle</th>
                  <th scope="col">Mileage</th>
                  <th scope="col">Advertised price</th>
                  <th scope="col">Adjusted value</th>
                  <th scope="col">Net adjustment</th>
                  <th scope="col">Disclosure status</th>
                  <th scope="col">Condition adjustment</th>
                  <th scope="col">Mileage adjustment</th>
                  <th scope="col">Options adjustment</th>
                  <th scope="col">Package adjustment</th>
                  <th scope="col">Reported contribution</th>
                </tr>
              </thead>
              <tbody>
                {insurer.comparables.map((comparable, index) => (
                  <tr key={`${index}:${comparable.vehicle}`}>
                    <th scope="row">
                      {displayed(comparable.vehicle, `Insurer comparable ${index + 1}`)}
                    </th>
                    <td>{numeric(comparable.mileage, " mi")}</td>
                    <td>{displayed(comparable.advertisedPrice)}</td>
                    <td>{displayed(comparable.adjustedValue)}</td>
                    <td>{displayed(comparable.netAdjustment, "Not disclosed")}</td>
                    <td>{disclosureLabel(comparable.adjustmentDisclosure)}</td>
                    <td>{displayed(comparable.adjustments.condition, "Not disclosed")}</td>
                    <td>{displayed(comparable.adjustments.mileage, "Not disclosed")}</td>
                    <td>{displayed(comparable.adjustments.options, "Not disclosed")}</td>
                    <td>{displayed(comparable.adjustments.package, "Not disclosed")}</td>
                    <td>{numeric(comparable.contributionPercent, "%")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No insurer comparables to display</p>
        )}
      </section>
      <section aria-labelledby="market-evidence-heading" id="market" tabIndex={-1}>
        <h3 id="market-evidence-heading">Selected market listings</h3>
        <p>Selected advertised listings from the completed review.</p>
        {(["primary", "secondary"] as const).map((role) => {
          const group = market[role];
          return group ? (
            <dl key={role}>
              <dt>{role === "primary" ? "Primary evidence" : "Additional evidence"}</dt>
              <dd>{group.label ? reportText(group.label) : "Not stated"}</dd>
              <dt>Selected listings</dt>
              <dd>{group.selectedCount.toLocaleString("en-US")}</dd>
              <dt>Evidence date</dt>
              <dd>{dateLabel(group.evidenceDate)}</dd>
            </dl>
          ) : null;
        })}
        {market.comparables.length ? (
          <div className="overflow-x-auto" tabIndex={0}>
            <table>
              <caption className="sr-only">Selected market listings</caption>
              <thead>
                <tr>
                  <th scope="col">Vehicle</th>
                  <th scope="col">Mileage</th>
                  <th scope="col">Advertised price</th>
                  <th scope="col">Distance</th>
                  <th scope="col">Dealer</th>
                  <th scope="col">Location</th>
                  <th scope="col">Evidence date</th>
                  <th scope="col">Listing context</th>
                  <th scope="col">Evidence role</th>
                </tr>
              </thead>
              <tbody>
                {market.comparables.map((comparable, index) => (
                  <tr key={`${index}:${comparable.vehicle}`}>
                    <th scope="row">
                      {displayed(comparable.vehicle, `Selected listing ${index + 1}`)}
                    </th>
                    <td>{numeric(comparable.mileage, " mi")}</td>
                    <td>{displayed(comparable.advertisedPrice)}</td>
                    <td>{numeric(comparable.distanceMiles, " mi")}</td>
                    <td>{displayed(comparable.dealer)}</td>
                    <td>{displayed(comparable.location)}</td>
                    <td>{dateLabel(comparable.evidenceDate)}</td>
                    <td>{temporalLabel(comparable.temporalBasis)}</td>
                    <td>{roleLabel(comparable.role)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No selected market listings to display</p>
        )}
      </section>
      <MethodologyDisclosure report={report} />
    </section>
  );
}
