import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { AppraisalServiceSlug } from "@/features/intake/types";
import { cn } from "@/lib/utils";

const PREVIEW_MOTION_DURATION_MS = 360;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

interface ExampleMetric {
  readonly label: string;
  readonly value: number;
  readonly signed?: boolean;
}

interface ExampleBar {
  readonly label: string;
  readonly value: number;
  readonly widthPercent: number;
  readonly emphasized?: boolean;
}

interface ExampleAnalysis {
  readonly vehicle: string;
  readonly metrics: readonly [ExampleMetric, ExampleMetric, ExampleMetric];
  readonly supportingLine: string;
  readonly bars: readonly [ExampleBar, ExampleBar];
  readonly explanation: string;
}

const exampleAnalysisByService: Record<
  AppraisalServiceSlug,
  ExampleAnalysis
> = {
  "total-loss": {
    vehicle: "2024 Hyundai Elantra SEL",
    metrics: [
      { label: "Insurer valuation", value: 19_050 },
      { label: "Local market evidence", value: 20_480 },
      { label: "Potential value gap", value: 1_430, signed: true },
    ],
    supportingLine: "12 comparable vehicles · within 87 miles",
    bars: [
      { label: "Insurer valuation", value: 19_050, widthPercent: 87 },
      {
        label: "Market evidence",
        value: 20_480,
        widthPercent: 94,
        emphasized: true,
      },
    ],
    explanation:
      "Venfour compares the insurer’s valuation with relevant market evidence.",
  },
  "diminished-value": {
    vehicle: "2025 Hyundai Tucson SEL",
    metrics: [
      { label: "Value before accident", value: 31_800 },
      { label: "Post-repair market value", value: 28_900 },
      { label: "Estimated value loss", value: 2_900 },
    ],
    supportingLine:
      "Accident history · repairs · mileage · local market",
    bars: [
      {
        label: "Before accident",
        value: 31_800,
        widthPercent: 94,
        emphasized: true,
      },
      { label: "Post-repair", value: 28_900, widthPercent: 85 },
    ],
    explanation:
      "Venfour helps document how an accident can affect a repaired vehicle’s market value.",
  },
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export interface ExampleAnalysisPreviewProps {
  readonly service: AppraisalServiceSlug;
}

export function ExampleAnalysisPreview({
  service,
}: ExampleAnalysisPreviewProps) {
  const example = exampleAnalysisByService[service];
  const reducedMotion = usePrefersReducedMotion();
  const comparisonLabel = `Value comparison: ${example.bars
    .map((bar) => `${bar.label}, ${formatCurrency(bar.value)}`)
    .join("; ")}`;

  return (
    <section
      className="mt-8 min-h-[16.5rem] border-t border-line/80 pt-5 sm:mt-10 sm:pt-6 lg:mt-11"
      aria-labelledby="example-analysis-heading"
      data-example-analysis
      data-example-service={service}
    >
      <p className="text-[0.6875rem] font-semibold tracking-[0.13em] text-copy/75 uppercase">
        Illustrative example
      </p>
      <h2
        id="example-analysis-heading"
        className="mt-1.5 text-lg font-semibold tracking-[-0.025em] text-ink"
        aria-label={example.vehicle}
      >
        <AnimatedText
          text={example.vehicle}
          motionKey={service}
          reducedMotion={reducedMotion}
          ariaHidden
        />
      </h2>

      <dl className="mt-4 grid grid-cols-3 gap-x-3 sm:gap-x-4">
        {example.metrics.map((metric, index) => (
          <div key={index} className="min-w-0">
            <dt
              className="text-[0.6875rem] leading-4 font-medium text-copy"
              aria-label={metric.label}
            >
              <AnimatedText
                className="min-h-8 items-end"
                text={metric.label}
                motionKey={service}
                reducedMotion={reducedMotion}
                ariaHidden
              />
            </dt>
            <dd
              className={cn(
                "mt-1 text-lg leading-none font-semibold tracking-[-0.025em] tabular-nums sm:text-xl",
                index === 2 ? "text-brand" : "text-ink",
              )}
            >
              <AnimatedCurrency
                value={metric.value}
                signed={metric.signed}
                reducedMotion={reducedMotion}
              />
            </dd>
          </div>
        ))}
      </dl>

      <p
        className="mt-3 text-xs leading-5 font-medium text-copy/85"
        aria-label={example.supportingLine}
      >
        <AnimatedText
          text={example.supportingLine}
          motionKey={service}
          reducedMotion={reducedMotion}
          ariaHidden
        />
      </p>

      <div
        className="mt-4 space-y-2.5"
        role="img"
        aria-label={comparisonLabel}
        data-example-comparison
      >
        {example.bars.map((bar, index) => (
          <div key={index} aria-hidden="true">
            <div className="flex items-baseline justify-between gap-4 text-[0.6875rem] leading-4 font-medium text-copy">
              <AnimatedText
                text={bar.label}
                motionKey={service}
                reducedMotion={reducedMotion}
                ariaHidden
              />
              <span className="shrink-0 font-semibold text-ink tabular-nums">
                <AnimatedCurrency
                  value={bar.value}
                  reducedMotion={reducedMotion}
                />
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line/55">
              <div
                className={cn(
                  "example-analysis-bar h-full rounded-full",
                  bar.emphasized ? "bg-brand" : "bg-ink/30",
                )}
                style={{ width: `${bar.widthPercent}%` }}
                data-example-bar={index}
                data-width-percent={bar.widthPercent}
              />
            </div>
          </div>
        ))}
      </div>

      <p
        className="mt-4 min-h-10 text-xs leading-5 text-copy"
        aria-label={example.explanation}
      >
        <AnimatedText
          text={example.explanation}
          motionKey={service}
          reducedMotion={reducedMotion}
          ariaHidden
        />
      </p>
    </section>
  );
}

interface AnimatedTextLayer {
  readonly id: number;
  readonly motionKey: string;
  readonly phase: "current" | "incoming" | "outgoing";
  readonly text: string;
}

interface AnimatedTextProps {
  readonly text: string;
  readonly motionKey: string;
  readonly reducedMotion: boolean;
  readonly className?: string;
  readonly ariaHidden?: boolean;
}

function AnimatedText({
  text,
  motionKey,
  reducedMotion,
  className,
  ariaHidden,
}: AnimatedTextProps) {
  const nextLayerIdRef = useRef(1);
  const [layers, setLayers] = useState<readonly AnimatedTextLayer[]>([
    { id: 0, motionKey, phase: "current", text },
  ]);
  const latestLayerRef = useRef(layers[0]);

  useLayoutEffect(() => {
    const latestLayer = latestLayerRef.current;
    if (
      latestLayer.motionKey === motionKey &&
      latestLayer.text === text
    ) {
      if (reducedMotion && latestLayer.phase !== "current") {
        const currentLayer = { ...latestLayer, phase: "current" as const };
        latestLayerRef.current = currentLayer;
        setLayers([currentLayer]);
      }
      return;
    }

    const nextLayer: AnimatedTextLayer = {
      id: nextLayerIdRef.current,
      motionKey,
      phase: reducedMotion ? "current" : "incoming",
      text,
    };
    nextLayerIdRef.current += 1;
    latestLayerRef.current = nextLayer;

    if (reducedMotion) {
      setLayers([nextLayer]);
      return;
    }

    setLayers([
      { ...latestLayer, phase: "outgoing" },
      nextLayer,
    ]);

    const timeout = window.setTimeout(() => {
      const currentLayer = { ...nextLayer, phase: "current" as const };
      latestLayerRef.current = currentLayer;
      setLayers([currentLayer]);
    }, PREVIEW_MOTION_DURATION_MS);

    return () => window.clearTimeout(timeout);
  }, [motionKey, reducedMotion, text]);

  return (
    <span
      className={cn("inline-grid overflow-hidden", className)}
      aria-hidden={ariaHidden || undefined}
    >
      {layers.map((layer) => (
        <span
          key={layer.id}
          className={cn(
            "col-start-1 row-start-1",
            layer.phase === "incoming" &&
              "example-analysis-copy-incoming",
            layer.phase === "outgoing" &&
              "example-analysis-copy-outgoing",
          )}
          aria-hidden={layer.phase === "outgoing" || undefined}
        >
          {layer.text}
        </span>
      ))}
    </span>
  );
}

interface AnimatedCurrencyProps {
  readonly value: number;
  readonly reducedMotion: boolean;
  readonly signed?: boolean;
}

function AnimatedCurrency({
  value,
  reducedMotion,
  signed,
}: AnimatedCurrencyProps) {
  const animatedValue = useAnimatedNumber(value, reducedMotion);
  const accessibleValue = formatCurrency(value, signed);

  return (
    <span aria-label={accessibleValue}>
      <span aria-hidden="true">
        {formatCurrency(animatedValue, signed)}
      </span>
    </span>
  );
}

function useAnimatedNumber(target: number, reducedMotion: boolean) {
  const [displayedValue, setDisplayedValue] = useState(target);
  const displayedValueRef = useRef(target);

  useLayoutEffect(() => {
    if (reducedMotion) {
      displayedValueRef.current = target;
      return;
    }

    const startingValue = displayedValueRef.current;
    let animationFrame = 0;

    if (startingValue === target) {
      animationFrame = window.requestAnimationFrame(() => {
        setDisplayedValue(target);
      });
      return () => window.cancelAnimationFrame(animationFrame);
    }

    let startingTime: number | null = null;

    const update = (timestamp: number) => {
      startingTime ??= timestamp;
      const elapsed = timestamp - startingTime;
      const progress = Math.min(elapsed / PREVIEW_MOTION_DURATION_MS, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      const nextValue = Math.round(
        startingValue + (target - startingValue) * easedProgress,
      );

      displayedValueRef.current = nextValue;
      setDisplayedValue(nextValue);

      if (progress < 1) {
        animationFrame = window.requestAnimationFrame(update);
      }
    };

    animationFrame = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [reducedMotion, target]);

  return reducedMotion ? target : displayedValue;
}

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(() =>
    readsReducedMotionPreference(),
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;

    const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    const updatePreference = () => setReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  return reducedMotion;
}

function readsReducedMotionPreference() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  );
}

function formatCurrency(value: number, signed = false) {
  const formatted = currencyFormatter.format(value);
  return signed && value > 0 ? `+${formatted}` : formatted;
}
