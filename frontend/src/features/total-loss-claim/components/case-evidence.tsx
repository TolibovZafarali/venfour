import {
  Fragment,
  useId,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

import type {
  TotalLossInsurerComparable,
  TotalLossMarketComparable,
  TotalLossMoney,
  TotalLossPublishedReport,
} from "@/features/total-loss-claim/contracts";

type ReportProps = { readonly report: TotalLossPublishedReport };
type EvidenceView = "market" | "insurer";
const INITIAL_ROWS = 5;

const CLASSIFICATION_LABELS: Readonly<Record<string, string>> = {
  MATERIAL_UNDERVALUE_SIGNAL: "Material undervaluation signal",
  MATERIAL_UNDERVALUATION_SIGNAL: "Material undervaluation signal",
  POTENTIAL_UNDERVALUE: "Potential undervaluation signal",
  POTENTIAL_UNDERVALUATION_SIGNAL: "Potential undervaluation signal",
  NO_MATERIAL_DISCREPANCY: "No material discrepancy identified",
  NO_MATERIAL_DISCREPANCY_IDENTIFIED: "No material discrepancy identified",
  NO_MATERIAL_DISCREPANCY_DETECTED: "No material discrepancy identified",
  INSUFFICIENT_EVIDENCE: "Insufficient evidence",
  CONFLICTING_EVIDENCE: "Conflicting market evidence",
  CONFLICTING_MARKET_EVIDENCE: "Conflicting market evidence",
};

function reportText(value: string) {
  const labels: Readonly<Record<string, string>> = {
    ...CLASSIFICATION_LABELS,
    CURRENT_MARKET: "current market",
    LOSS_DATE_HISTORICAL: "historical evidence from around the loss date",
    BELOW_OBSERVED_RANGE: "below the selected range",
    WITHIN_OBSERVED_RANGE: "within the selected range",
    ABOVE_OBSERVED_RANGE: "above the selected range",
  };
  return value
    .replace(
      /\b[A-Z]+(?:_[A-Z]+)+\b/gu,
      (code) => labels[code] ?? "details in the evidence package",
    )
    .replace(/The deterministic assessment/gu, "The completed review");
}

function displayed(value: string | null | undefined, fallback = "—") {
  return value && !/^(unavailable|unknown|not available)$/iu.test(value.trim())
    ? value
    : fallback;
}

function moneyLabel(value: TotalLossMoney | null | undefined) {
  return value?.amountMinorUnits === null
    ? "Not stated"
    : displayed(value?.formatted, "Not stated");
}

function dateLabel(value: string | null) {
  if (!value) return "Not stated";
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.valueOf())
    ? "Not stated"
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(date);
}

function selectedCount(report: TotalLossPublishedReport) {
  return (
    (report.marketEvidence.primary?.selectedCount ?? 0) +
    (report.marketEvidence.secondary?.selectedCount ?? 0)
  );
}

function differenceLabel(report: TotalLossPublishedReport) {
  const difference = report.conclusion.indicatedDifference;
  const insurer = report.conclusion.insurerValuation.amountMinorUnits;
  const median = report.conclusion.supportedRange?.median.amountMinorUnits;
  if (
    !difference ||
    difference.amountMinorUnits === null ||
    insurer === null ||
    median === null ||
    median === undefined
  )
    return null;
  if (insurer === median)
    return "The insurer’s value matches the selected listing median.";
  const magnitude = difference.formatted
    .replace(/[−-]/gu, "")
    .replace(/^\((.*)\)$/u, "$1");
  return `${magnitude} ${insurer < median ? "below" : "above"} the selected listing median`;
}

export function ValueRangeComparison({
  report,
  showDifference = true,
}: ReportProps & { readonly showDifference?: boolean }) {
  const range = report.conclusion.supportedRange;
  const insurer = report.conclusion.insurerValuation;
  const low = range?.low.amountMinorUnits;
  const high = range?.high.amountMinorUnits;
  const median = range?.median.amountMinorUnits;
  if (
    !range ||
    low === null ||
    low === undefined ||
    high === null ||
    high === undefined ||
    median === null ||
    median === undefined
  ) {
    return (
      <div className="case-comparison-empty">
        <p>A selected market range is not available for this result.</p>
        <p>
          The evidence package explains what the completed review could support.
        </p>
      </div>
    );
  }
  const points = [
    low,
    high,
    median,
    ...(insurer.amountMinorUnits === null ? [] : [insurer.amountMinorUnits]),
  ];
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || Math.max(Math.abs(max) * 0.1, 1);
  const position = (value: number) =>
    max === min ? 50 : 10 + ((value - min) / span) * 80;
  const insurerPosition =
    insurer.amountMinorUnits === null
      ? null
      : position(insurer.amountMinorUnits);
  const style = {
    "--case-range-low": `${position(low)}%`,
    "--case-range-high": `${position(high)}%`,
    "--case-range-width": `${position(high) - position(low)}%`,
    "--case-range-median": `${position(median)}%`,
    "--case-range-insurer": `${insurerPosition ?? 0}%`,
  } as CSSProperties;
  const difference = differenceLabel(report);
  return (
    <figure className="case-comparison">
      <div
        aria-label={`Insurer value ${moneyLabel(insurer)}; selected listing range ${moneyLabel(range.low)} to ${moneyLabel(range.high)}; median ${moneyLabel(range.median)}.`}
        className="case-range-plot"
        data-position={
          insurer.amountMinorUnits === null
            ? "missing"
            : insurer.amountMinorUnits < low
              ? "below"
              : insurer.amountMinorUnits > high
                ? "above"
                : "within"
        }
        role="img"
        style={style}
      >
        <div aria-hidden="true" className="case-range-axis" />
        <div aria-hidden="true" className="case-range-band" />
        <div aria-hidden="true" className="case-range-median">
          <span className="case-range-median-label">Median</span>
        </div>
        {insurerPosition !== null ? (
          <div aria-hidden="true" className="case-range-insurer">
            <span className="case-range-insurer-label">
              <span>Insurer valuation</span>
              <strong>{moneyLabel(insurer)}</strong>
            </span>
          </div>
        ) : (
          <p className="case-range-no-insurer">Insurer valuation not stated</p>
        )}
      </div>
      <div aria-hidden="true" className="case-range-legend">
        <p className="case-range-legend-title">Selected listing prices</p>
        <div className="case-range-labels">
          <div>
            <span>Range low</span>
            <strong>{moneyLabel(range.low)}</strong>
          </div>
          <div>
            <span>Selected median</span>
            <strong>{moneyLabel(range.median)}</strong>
          </div>
          <div>
            <span>Range high</span>
            <strong>{moneyLabel(range.high)}</strong>
          </div>
        </div>
      </div>
      {showDifference && difference ? (
        <figcaption className="case-comparison-difference">
          {difference}
        </figcaption>
      ) : null}
    </figure>
  );
}

export function MethodologyDisclosure({ report }: ReportProps) {
  const context = report.marketEvidence.evidenceDateContext;
  return (
    <details className="case-disclosure">
      <summary>Methodology and limitations</summary>
      <div className="case-disclosure-content">
        <dl className="case-evidence-dates">
          <div>
            <dt>Date of loss</dt>
            <dd>{dateLabel(context.lossDate)}</dd>
          </div>
          <div>
            <dt>Current listings collected</dt>
            <dd>{dateLabel(context.currentObservedDate)}</dd>
          </div>
          <div>
            <dt>Historical evidence date</dt>
            <dd>
              {context.historicalEvidenceDate
                ? dateLabel(context.historicalEvidenceDate)
                : "No historical date provided"}
            </dd>
          </div>
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
        <p>{reportText(report.conclusion.summary)}</p>
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
      </div>
    </details>
  );
}

function numeric(value: number | null, suffix = "") {
  return value === null
    ? "—"
    : `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}${suffix}`;
}

function disclosureLabel(value: string | null) {
  if (value === null) return "Not stated";
  const key = value.toLowerCase().replace(/_/gu, " ");
  if (["none", "undisclosed", "not disclosed"].includes(key))
    return "Not disclosed";
  if (["partial", "partially disclosed"].includes(key))
    return "Partially disclosed";
  if (["full", "fully disclosed"].includes(key)) return "Fully disclosed";
  if (key === "unavailable") return "Details unavailable";
  return /^[A-Z][A-Z_]+$/u.test(value) ? "Not stated" : value;
}

function temporalLabel(value: string | null) {
  if (!value) return "Not stated";
  if (/historical|loss.date/iu.test(value)) return "Historical listing";
  if (/current/iu.test(value)) return "Current listing";
  return /^[A-Z][A-Z_]+$/u.test(value) ? "See evidence package" : value;
}

function roleLabel(value: string | null) {
  if (!value) return "Not stated";
  if (/primary/iu.test(value)) return "Primary comparison evidence";
  if (/secondary/iu.test(value)) return "Additional context evidence";
  return /^[A-Z][A-Z_]+$/u.test(value) ? "Selected evidence" : value;
}

function EvidenceRowHeading({
  vehicle,
  expanded,
  detailsId,
  onToggle,
}: {
  readonly vehicle: string;
  readonly expanded: boolean;
  readonly detailsId: string;
  readonly onToggle: () => void;
}) {
  return (
    <th scope="row" className="case-table-vehicle">
      <span>{vehicle}</span>
      <button
        aria-controls={detailsId}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Hide" : "Show"} details for ${vehicle}`}
        className="case-button case-row-toggle"
        data-variant="text"
        onClick={onToggle}
        type="button"
      >
        {expanded ? "Hide details" : "Details"}
      </button>
    </th>
  );
}

function MarketRow({
  comparable,
  index,
}: {
  readonly comparable: TotalLossMarketComparable;
  readonly index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const vehicle = displayed(
    comparable.vehicle,
    `Selected listing ${index + 1}`,
  );
  return (
    <Fragment>
      <tr>
        <EvidenceRowHeading
          vehicle={vehicle}
          expanded={expanded}
          detailsId={detailsId}
          onToggle={() => setExpanded(!expanded)}
        />
        <td className="case-table-numeric" data-label="Mileage">
          {numeric(comparable.mileage, " mi")}
        </td>
        <td
          className="case-table-numeric case-table-price"
          data-label="Advertised price"
        >
          {displayed(comparable.advertisedPrice)}
        </td>
        <td className="case-table-numeric" data-label="Distance">
          {numeric(comparable.distanceMiles, " mi")}
        </td>
      </tr>
      {expanded ? (
        <tr className="case-table-details" id={detailsId}>
          <td colSpan={4}>
            <dl className="case-row-details">
              <div>
                <dt>Dealer</dt>
                <dd>{displayed(comparable.dealer)}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{displayed(comparable.location)}</dd>
              </div>
              <div>
                <dt>Evidence date</dt>
                <dd>{dateLabel(comparable.evidenceDate)}</dd>
              </div>
              <div>
                <dt>Listing context</dt>
                <dd>{temporalLabel(comparable.temporalBasis)}</dd>
              </div>
              <div>
                <dt>Evidence role</dt>
                <dd>{roleLabel(comparable.role)}</dd>
              </div>
            </dl>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

function InsurerRow({
  comparable,
  index,
}: {
  readonly comparable: TotalLossInsurerComparable;
  readonly index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const vehicle = displayed(
    comparable.vehicle,
    `Insurer comparable ${index + 1}`,
  );
  return (
    <Fragment>
      <tr>
        <EvidenceRowHeading
          vehicle={vehicle}
          expanded={expanded}
          detailsId={detailsId}
          onToggle={() => setExpanded(!expanded)}
        />
        <td className="case-table-numeric" data-label="Mileage">
          {numeric(comparable.mileage, " mi")}
        </td>
        <td className="case-table-numeric" data-label="Advertised price">
          {displayed(comparable.advertisedPrice)}
        </td>
        <td
          className="case-table-numeric case-table-price"
          data-label="Adjusted value"
        >
          {displayed(comparable.adjustedValue)}
        </td>
        <td className="case-table-numeric" data-label="Net adjustment">
          {displayed(comparable.netAdjustment, "Not disclosed")}
        </td>
        <td data-label="Disclosure status">
          {disclosureLabel(comparable.adjustmentDisclosure)}
        </td>
      </tr>
      {expanded ? (
        <tr className="case-table-details" id={detailsId}>
          <td colSpan={6}>
            <dl className="case-row-details">
              <div>
                <dt>Condition adjustment</dt>
                <dd>
                  {displayed(comparable.adjustments.condition, "Not disclosed")}
                </dd>
              </div>
              <div>
                <dt>Mileage adjustment</dt>
                <dd>
                  {displayed(comparable.adjustments.mileage, "Not disclosed")}
                </dd>
              </div>
              <div>
                <dt>Options adjustment</dt>
                <dd>
                  {displayed(comparable.adjustments.options, "Not disclosed")}
                </dd>
              </div>
              <div>
                <dt>Package adjustment</dt>
                <dd>
                  {displayed(comparable.adjustments.package, "Not disclosed")}
                </dd>
              </div>
              {comparable.contributionPercent !== null ? (
                <div>
                  <dt>Reported contribution</dt>
                  <dd>{numeric(comparable.contributionPercent, "%")}</dd>
                </div>
              ) : null}
            </dl>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

function EvidenceTable({
  report,
  view,
}: ReportProps & { readonly view: EvidenceView }) {
  const [showAll, setShowAll] = useState(false);
  const isMarket = view === "market";
  const rows = isMarket
    ? report.marketEvidence.comparables
    : report.insurerEvidence.comparables;
  const rowLimit = showAll ? rows.length : INITIAL_ROWS;
  if (!rows.length)
    return (
      <div className="case-evidence-empty">
        <h3>
          {isMarket
            ? "No selected market listings to display"
            : "No insurer comparables to display"}
        </h3>
        <p>
          The evidence package explains the information available for this
          review.
        </p>
      </div>
    );
  return (
    <div className="case-table-container">
      <table
        className={`case-evidence-table ${isMarket ? "case-market-table" : "case-insurer-table"}`}
      >
        <caption className="sr-only">
          {isMarket ? "Selected market listings" : "Insurer comparables"}
        </caption>
        <thead>
          <tr>
            <th scope="col">Vehicle</th>
            <th className="case-table-numeric" scope="col">
              Mileage
            </th>
            <th className="case-table-numeric" scope="col">
              Advertised price
            </th>
            {isMarket ? (
              <th className="case-table-numeric" scope="col">
                Distance
              </th>
            ) : (
              <>
                <th className="case-table-numeric" scope="col">
                  Adjusted value
                </th>
                <th className="case-table-numeric" scope="col">
                  Net adjustment
                </th>
                <th scope="col">Disclosure status</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {isMarket
            ? report.marketEvidence.comparables
                .slice(0, rowLimit)
                .map((comparable, index) => (
                  <MarketRow
                    comparable={comparable}
                    index={index}
                    key={`${index}:${comparable.vehicle}`}
                  />
                ))
            : report.insurerEvidence.comparables
                .slice(0, rowLimit)
                .map((comparable, index) => (
                  <InsurerRow
                    comparable={comparable}
                    index={index}
                    key={`${index}:${comparable.vehicle}`}
                  />
                ))}
        </tbody>
      </table>
      {rows.length > INITIAL_ROWS ? (
        <div className="case-table-footer">
          <p>
            Showing {Math.min(rowLimit, rows.length)} of {rows.length}{" "}
            {isMarket ? "listings" : "comparables"}
          </p>
          <button
            className="case-button"
            data-variant="secondary"
            onClick={() => setShowAll(!showAll)}
            type="button"
          >
            {showAll ? "Show fewer" : `Show all ${rows.length}`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function CaseEvidence({
  report,
  initialView = "market",
  headingLevel = 1,
  onViewChange,
  view: controlledView,
}: ReportProps & {
  readonly initialView?: EvidenceView;
  readonly headingLevel?: 1 | 2;
  readonly onViewChange?: (view: EvidenceView) => void;
  readonly view?: EvidenceView;
}) {
  const [internalView, setInternalView] = useState<EvidenceView>(initialView);
  const view = controlledView ?? internalView;
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const id = useId();
  const selectView = (next: EvidenceView) => {
    setInternalView(next);
    onViewChange?.(next);
  };
  const selectOnKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? "market"
        : event.key === "End"
          ? "insurer"
          : view === "market"
            ? "insurer"
            : "market";
    selectView(next);
    const tabs =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        '[role="tab"]',
      );
    tabs?.[next === "market" ? 0 : 1]?.focus();
  };
  return (
    <div className="case-evidence">
      <header className="case-section-intro">
        <Heading>Evidence</Heading>
        <p className="case-lead">
          We reviewed{" "}
          {report.insurerEvidence.comparableCount.toLocaleString("en-US")}{" "}
          insurer comparables and selected{" "}
          {selectedCount(report).toLocaleString("en-US")} additional market
          listings for comparison.
        </p>
      </header>
      <div
        className="case-evidence-tabs"
        role="tablist"
        aria-label="Evidence views"
      >
        {(["market", "insurer"] as const).map((tab) => (
          <button
            aria-controls={`${id}-panel`}
            aria-selected={view === tab}
            className="case-button case-evidence-tab"
            data-variant="text"
            id={`${id}-${tab}`}
            key={tab}
            onClick={() => selectView(tab)}
            onKeyDown={selectOnKey}
            role="tab"
            tabIndex={view === tab ? 0 : -1}
            type="button"
          >
            {tab === "market"
              ? "Selected market listings"
              : "Insurer comparables"}
          </button>
        ))}
      </div>
      <div
        aria-labelledby={`${id}-${view}`}
        className="case-evidence-panel"
        id={`${id}-panel`}
        role="tabpanel"
        tabIndex={0}
      >
        {view === "insurer" ? (
          <p className="case-table-intro">
            The insurer used{" "}
            {report.insurerEvidence.comparableCount.toLocaleString("en-US")}{" "}
            comparable vehicles. Detailed adjustment information was available
            for{" "}
            {report.insurerEvidence.summary.fullyDisclosedAdjustmentCount.toLocaleString(
              "en-US",
            )}
            .
          </p>
        ) : (
          <p className="case-table-intro">
            Selected advertised listings from the completed review. Open a row
            for its source and date details.
          </p>
        )}
        <EvidenceTable key={view} report={report} view={view} />
      </div>
      <MethodologyDisclosure report={report} />
    </div>
  );
}
