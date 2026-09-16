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
        <p>Your valuation report contains the complete methodology, limitations, and technical evidence.</p>
      </div>
    </EvidenceDisclosure>
  );
}

export function HigherPricedListings({ report }: { report: Pick<TotalLossPublishedReport, "marketEvidence"> }) {
  const evidence = report.marketEvidence.higherPricedComparableListings;
  if (!evidence?.listings.length) return null;
  return <section className="completed-evidence supporting-listings" aria-labelledby="supporting-listings-title">
    <h2 id="supporting-listings-title">{evidence.title}</h2>
    <p>{evidence.disclosure}</p>
    {evidence.listings.map((listing) => <article key={listing.identity} className="supporting-listing">
      <h3>{listing.vehicle}</h3>
      <p><strong>{listing.askingPriceDisplay}</strong> asking price</p>
      <p>{numeric(listing.mileage, " miles")} · {numeric(listing.distanceMiles, " miles from you")} · {dateLabel(listing.relevantDate)}</p>
      <p>{listing.temporalBasis} · Source: {listing.source} ({listing.priceSource === "history" ? "verified history record" : "active listing"})</p>
      {listing.matchingFacts.length ? <dl className="completed-evidence__dates">{listing.matchingFacts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl> : null}
      {listing.materialDifferences.length ? <ul>{listing.materialDifferences.map((difference) => <li key={difference}>{difference}</li>)}</ul> : null}
      <ul>{listing.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
      {listing.listingUrl ? <a href={listing.listingUrl} target="_blank" rel="noopener noreferrer">View listing source</a> : null}
    </article>)}
  </section>;
}

export function MarketSearchLimitations({ report }: { report: Pick<TotalLossPublishedReport, "marketEvidence"> }) {
  const context = report.marketEvidence.marketSearchContext;
  if (context?.baselineStatus !== "LIMITED") return null;
  return <aside className="completed-evidence market-search-limitations" aria-label="Comparable search limitations">
    <h2>What we couldn’t check</h2>
    <p>{context.summary}</p>
    <ul>{context.stopReasons.map((reason) => <li key={`${reason.stream}:${reason.code}`}>{reason.stream === "historical" ? "Loss-date evidence" : "Current evidence"}: {reason.description}</li>)}</ul>
  </aside>;
}

export function InsurerEvidenceDetails({ report, open }: ReportProps) {
  const rows = report.insurerEvidence.comparables;
  return <EvidenceDisclosure label="See the vehicles they used" open={open}>
    {rows.length ? <>
      <p className="insurer-vehicles-intro">Open a vehicle to see the changes listed in your insurer’s report.</p>
      <div className="insurer-vehicles">
        {rows.map((row, index) => {
          const vehicle = displayed(row.vehicle, `Vehicle ${index + 1} in their report`);
          return <details className="insurer-vehicle" key={`${index}:${row.vehicle}`} aria-label={vehicle}>
            <summary>
              <span className="insurer-vehicle-identity"><strong>{vehicle}</strong><span>{row.mileage === null ? "Mileage not provided" : numeric(row.mileage, " miles")}</span></span>
              <span className="insurer-vehicle-price"><span>{row.sourcePrice?.typeLabel ?? "Asking price"}</span><strong>{displayed(row.sourcePrice ? row.sourcePrice.amount : row.advertisedPrice, "Not provided")}</strong></span>
              <span className="insurer-vehicle-price"><span>After adjustments</span><strong>{displayed(row.adjustedValue, "Not provided")}</strong></span>
              <ChevronDown aria-hidden="true" size={18} />
            </summary>
            <div className="insurer-vehicle-details">
              <p>Adjustment details: {disclosureLabel(row.adjustmentDisclosure).toLowerCase()}.</p>
              <dl>
                <div><dt>Condition</dt><dd>{displayed(row.adjustments.condition, "Not disclosed")}</dd></div>
                <div><dt>Mileage</dt><dd>{displayed(row.adjustments.mileage, "Not disclosed")}</dd></div>
                <div><dt>Options and features</dt><dd>{displayed(row.adjustments.options, "Not disclosed")}</dd></div>
                <div><dt>Equipment packages</dt><dd>{displayed(row.adjustments.package, "Not disclosed")}</dd></div>
                <div className="insurer-vehicle-total"><dt>Total adjustment</dt><dd>{displayed(row.netAdjustment, "Not disclosed")}</dd></div>
                {row.contributionPercent !== null ? <div><dt>Weight in the insurer’s calculation</dt><dd>{numeric(row.contributionPercent, "%")}</dd></div> : null}
              </dl>
              <p className="review-note">These changes and any weighting come from your insurer’s report. Missing details do not mean a change was wrong.</p>
            </div>
          </details>;
        })}
      </div>
      {report.insurerEvidence.comparableCount > rows.length ? <p className="review-note">Details are available here for {rows.length} of the {report.insurerEvidence.comparableCount} vehicles in the report.</p> : null}
      {(["advertisedPrices", "adjustedValues"] as const).map((kind) => {
        const summary = report.insurerEvidence.summary[kind];
        return summary && summary.count > 1 && summary.low?.amountMinorUnits != null && summary.high?.amountMinorUnits != null && displayed(summary.low.formatted, "") && displayed(summary.high.formatted, "") ? <p className="review-note" key={kind}>{kind === "advertisedPrices" ? "Disclosed advertised prices" : "Disclosed adjusted values"} ranged from {moneyLabel(summary.low)} to {moneyLabel(summary.high)}.</p> : null;
      })}
    </> : <p className="completed-evidence__empty">Vehicle details weren’t available in the report.</p>}
  </EvidenceDisclosure>;
}

export function MarketEvidenceDetails({ report, open }: ReportProps) {
  const rows = report.marketEvidence.comparables;
  return <section className="market-vehicles" aria-label="Vehicle listings">
    {rows.length ? <>
      <p className="market-vehicles-intro">Open a vehicle to see its source and listing details.</p>
      {rows.map((row, index) => {
        const vehicle = displayed(row.vehicle, `Vehicle listing ${index + 1}`);
        const role = roleLabel(row.role);
        const purpose = role === "Primary comparison evidence" ? "Used in this comparison" : role === "Additional context evidence" ? "Additional context" : "Comparison role not specified";
        return <details className="market-vehicle" key={`${index}:${row.vehicle}`} aria-label={vehicle} open={open || undefined} data-review-entrance="supporting" data-review-order={index}>
          <summary>
            <span className="market-vehicle-identity"><strong>{vehicle}</strong><span>{row.mileage === null ? "Mileage not provided" : numeric(row.mileage, " miles")} · {displayed(row.location, "Location not provided")}</span><span className="market-vehicle-purpose">{purpose}</span></span>
            <span className="market-vehicle-price"><span>Asking price</span><strong>{displayed(row.advertisedPrice, "Not provided")}</strong></span>
            <ChevronDown aria-hidden="true" size={18} />
          </summary>
          <div className="market-vehicle-details">
            <dl>
              <div><dt>Dealer</dt><dd>{displayed(row.dealer, "Not provided")}</dd></div>
              <div><dt>Distance from you</dt><dd>{row.distanceMiles === null ? "Not provided" : numeric(row.distanceMiles, " miles")}</dd></div>
              <div><dt>Price recorded</dt><dd>{dateLabel(row.evidenceDate)}</dd></div>
              <div><dt>Listing timing</dt><dd>{temporalLabel(row.temporalBasis)}</dd></div>
            </dl>
            {role === "Additional context evidence" ? <p>This listing provides additional context and is not included in the comparison’s price range.</p> : null}
            {purpose === "Comparison role not specified" && role !== "Not stated" ? <p>{role}</p> : null}
          </div>
        </details>;
      })}
    </> : <p className="completed-evidence__empty">No vehicle listings were available to show.</p>}
  </section>;
}
