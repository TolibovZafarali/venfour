import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
} from "lucide-react";
import { Popover } from "radix-ui";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ChangeEventHandler,
  CSSProperties,
  HTMLInputTypeAttribute,
  Key,
  ReactNode,
  Ref,
} from "react";

import { cn } from "@/lib/utils";

export const totalLossInputClassName =
  "mt-2 min-h-12 w-full rounded-lg border border-line bg-white px-3.5 text-base text-ink shadow-sm transition-colors placeholder:text-copy/50 hover:border-line-strong focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25 disabled:cursor-not-allowed disabled:bg-surface aria-invalid:border-red-500 aria-invalid:ring-red-500/15 motion-reduce:transition-none";

export interface IntakeTextFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  error?: string;
  help?: string;
  optional?: boolean;
  type?: HTMLInputTypeAttribute;
  inputMode?:
    | "none"
    | "text"
    | "decimal"
    | "numeric"
    | "tel"
    | "search"
    | "email"
    | "url";
  autoComplete?: string;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  onBlur?: () => void;
}

export interface IntakeSelectOption {
  readonly label: string;
  readonly value: string;
}

export interface IntakeSelectFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: ChangeEventHandler<HTMLSelectElement>;
  options: readonly (string | IntakeSelectOption)[];
  error?: string;
  help?: string;
  optional?: boolean;
  placeholder: string;
  disabled?: boolean;
  loading?: boolean;
  onBlur?: () => void;
}

export function IntakeSelectField({
  id,
  label,
  value,
  onChange,
  options,
  error,
  help,
  optional = false,
  placeholder,
  disabled,
  loading,
  onBlur,
}: IntakeSelectFieldProps) {
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold text-ink">
          {label}
        </label>
        {optional ? <span className="text-xs text-copy">Optional</span> : null}
      </div>
      {help ? (
        <p id={helpId} className="mt-1 text-xs leading-5 text-copy">
          {help}
        </p>
      ) : null}
      <div className="relative">
        <select
          id={id}
          name={id}
          value={value}
          disabled={disabled || loading}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(totalLossInputClassName, "appearance-none pr-10")}
          onChange={onChange}
          onBlur={onBlur}
        >
          <option value="">{loading ? "Loading options…" : placeholder}</option>
          {options.map((option) => {
            const normalized =
              typeof option === "string"
                ? { label: option, value: option }
                : option;
            return (
              <option key={normalized.value} value={normalized.value}>
                {normalized.label}
              </option>
            );
          })}
        </select>
        <span
          className="pointer-events-none absolute right-3.5 top-1/2 mt-1 size-0 -translate-y-1/2 border-x-[5px] border-t-[6px] border-x-transparent border-t-copy"
          aria-hidden
        />
      </div>
      {error ? (
        <p
          id={errorId}
          className="mt-1.5 text-sm leading-5 text-red-700"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface IntakeDatePickerProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
  onBlur?: () => void;
  calendarLabel?: string;
}

const monthNames = Array.from({ length: 12 }, (_, monthIndex) =>
  new Intl.DateTimeFormat("en-US", { month: "long" }).format(
    new Date(2020, monthIndex, 1),
  ),
);
const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function IntakeDatePicker({
  id,
  label,
  value,
  onChange,
  error,
  disabled,
  onBlur,
  calendarLabel = "Choose date of loss",
}: IntakeDatePickerProps) {
  const today = useMemo(() => startOfLocalDay(new Date()), []);
  const selectedDate = parseIsoDate(value);
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() =>
    startOfMonth(selectedDate ?? today),
  );
  const errorId = error ? `${id}-error` : undefined;
  const years = useMemo(
    () =>
      Array.from(
        { length: today.getFullYear() - 1900 + 1 },
        (_, index) => today.getFullYear() - index,
      ),
    [today],
  );
  const calendarDays = useMemo(
    () => daysForCalendarMonth(visibleMonth),
    [visibleMonth],
  );

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setVisibleMonth(
        startOfMonth(
          selectedDate && selectedDate.getTime() <= today.getTime()
            ? selectedDate
            : today,
        ),
      );
    }
    setOpen(nextOpen);
    if (!nextOpen) onBlur?.();
  };

  return (
    <div>
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <Popover.Root open={open} onOpenChange={handleOpenChange}>
        <Popover.Trigger asChild>
          <button
            id={id}
            type="button"
            disabled={disabled}
            aria-invalid={error ? true : undefined}
            aria-describedby={errorId}
            className={cn(
              totalLossInputClassName,
              "flex items-center justify-between gap-3 text-left",
              !value && "text-copy/60",
            )}
          >
            <span>{value ? formatDateLabel(value) : "Choose a date"}</span>
            <CalendarDays className="size-4 shrink-0 text-copy" aria-hidden />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={8}
            className="z-50 w-[min(21rem,calc(100vw-2rem))] rounded-xl border border-line bg-white p-4 shadow-[0_24px_70px_-30px_rgba(11,31,51,0.45)] outline-none"
          >
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="flex size-10 items-center justify-center rounded-lg text-copy hover:bg-brand-soft hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                aria-label="Previous month"
                onClick={() => setVisibleMonth(addMonths(visibleMonth, -1))}
              >
                <ChevronLeft className="size-4" aria-hidden />
              </button>
              <div className="flex min-w-0 flex-1 gap-2">
                <select
                  aria-label="Calendar month"
                  className="min-h-10 min-w-0 flex-1 rounded-lg border border-line bg-white px-2 text-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  value={visibleMonth.getMonth()}
                  onChange={(event) =>
                    setVisibleMonth(
                      new Date(
                        visibleMonth.getFullYear(),
                        Number(event.target.value),
                        1,
                      ),
                    )
                  }
                >
                  {monthNames.map((month, index) => (
                    <option
                      key={month}
                      value={index}
                      disabled={
                        visibleMonth.getFullYear() === today.getFullYear() &&
                        index > today.getMonth()
                      }
                    >
                      {month}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Calendar year"
                  className="min-h-10 w-24 rounded-lg border border-line bg-white px-2 text-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  value={visibleMonth.getFullYear()}
                  onChange={(event) => {
                    const nextYear = Number(event.target.value);
                    const nextMonth =
                      nextYear === today.getFullYear()
                        ? Math.min(visibleMonth.getMonth(), today.getMonth())
                        : visibleMonth.getMonth();
                    setVisibleMonth(new Date(nextYear, nextMonth, 1));
                  }}
                >
                  {years.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="flex size-10 items-center justify-center rounded-lg text-copy hover:bg-brand-soft hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-35"
                aria-label="Next month"
                disabled={!canMoveToNextMonth(visibleMonth, today)}
                onClick={() => setVisibleMonth(addMonths(visibleMonth, 1))}
              >
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>
            <div
              className="mt-4 grid grid-cols-7 gap-1"
              role="grid"
              aria-label={calendarLabel}
            >
              {weekdayNames.map((weekday) => (
                <span
                  key={weekday}
                  className="flex h-8 items-center justify-center text-[0.6875rem] font-semibold text-copy"
                  aria-hidden
                >
                  {weekday}
                </span>
              ))}
              {calendarDays.map((day, index) =>
                day ? (
                  <button
                    key={day.toISOString()}
                    type="button"
                    role="gridcell"
                    className={cn(
                      "flex size-9 items-center justify-center rounded-lg text-sm font-medium text-ink hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:text-copy/30",
                      sameLocalDate(day, selectedDate) &&
                        "bg-brand text-white hover:bg-brand-strong",
                      sameLocalDate(day, today) &&
                        !sameLocalDate(day, selectedDate) &&
                        "ring-1 ring-brand/35",
                    )}
                    disabled={day.getTime() > today.getTime()}
                    aria-label={formatDateLabel(toIsoDate(day))}
                    aria-selected={sameLocalDate(day, selectedDate)}
                    onClick={() => {
                      onChange(toIsoDate(day));
                      setOpen(false);
                    }}
                  >
                    {day.getDate()}
                  </button>
                ) : (
                  <span key={`empty-${index}`} className="size-9" aria-hidden />
                ),
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {error ? (
        <p
          id={errorId}
          className="mt-1.5 text-sm leading-5 text-red-700"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function IntakeTextField({
  id,
  label,
  value,
  onChange,
  error,
  help,
  optional = false,
  type = "text",
  inputMode = "text",
  autoComplete,
  placeholder,
  maxLength,
  disabled,
  inputRef,
  onBlur,
}: IntakeTextFieldProps) {
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold text-ink">
          {label}
        </label>
        {optional ? <span className="text-xs text-copy">Optional</span> : null}
      </div>
      {help ? (
        <p id={helpId} className="mt-1 text-xs leading-5 text-copy">
          {help}
        </p>
      ) : null}
      <input
        ref={inputRef}
        id={id}
        name={id}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={totalLossInputClassName}
        onChange={onChange}
        onBlur={onBlur}
      />
      {error ? (
        <p
          id={errorId}
          className="mt-1.5 text-sm leading-5 text-red-700"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface IntakeTextareaFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: ChangeEventHandler<HTMLTextAreaElement>;
  error?: string;
  help?: string;
  optional?: boolean;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  disabled?: boolean;
  autoComplete?: string;
  textareaRef?: Ref<HTMLTextAreaElement>;
  onBlur?: () => void;
}

export function IntakeTextareaField({
  id,
  label,
  value,
  onChange,
  error,
  help,
  optional = false,
  placeholder,
  rows = 5,
  maxLength,
  disabled,
  autoComplete,
  textareaRef,
  onBlur,
}: IntakeTextareaFieldProps) {
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold text-ink">
          {label}
        </label>
        {optional ? <span className="text-xs text-copy">Optional</span> : null}
      </div>
      {help ? (
        <p id={helpId} className="mt-1 text-xs leading-5 text-copy">
          {help}
        </p>
      ) : null}
      <textarea
        ref={textareaRef}
        id={id}
        name={id}
        value={value}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(totalLossInputClassName, "py-3 leading-6")}
        onChange={onChange}
        onBlur={onBlur}
      />
      {error ? (
        <p
          id={errorId}
          className="mt-1.5 text-sm leading-5 text-red-700"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

export interface IntakeRadioChoiceOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
}

export interface IntakeRadioChoiceGroupProps {
  id: string;
  name?: string;
  legend: string;
  value: string;
  options: readonly IntakeRadioChoiceOption[];
  onChange: (value: string) => void;
  error?: string;
  help?: string;
  optional?: boolean;
  disabled?: boolean;
  columns?: 1 | 2 | 3 | 4;
  onBlur?: () => void;
}

const radioGridColumns = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
} as const;

export function IntakeRadioChoiceGroup({
  id,
  name = id,
  legend,
  value,
  options,
  onChange,
  error,
  help,
  optional = false,
  disabled,
  columns = 3,
  onBlur,
}: IntakeRadioChoiceGroupProps) {
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <fieldset>
      <legend className="w-full">
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-semibold text-ink">{legend}</span>
          {optional ? (
            <span className="text-xs text-copy">Optional</span>
          ) : null}
        </span>
      </legend>
      {help ? (
        <p id={helpId} className="mt-1 text-xs leading-5 text-copy">
          {help}
        </p>
      ) : null}
      <div className={cn("mt-3 grid gap-3", radioGridColumns[columns])}>
        {options.map((option, index) => {
          const optionId = index === 0 ? id : `${id}-${index + 1}`;
          const selected = value === option.value;
          return (
            <label
              key={option.value}
              htmlFor={optionId}
              className={cn(
                "relative flex min-h-12 cursor-pointer flex-col justify-center rounded-xl border bg-white px-4 py-3 transition-colors focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-2 hover:border-brand/45 hover:bg-brand-soft/35 motion-reduce:transition-none",
                selected
                  ? "border-brand bg-brand-soft/45 shadow-[inset_0_0_0_1px_var(--brand)]"
                  : "border-line",
                disabled && "cursor-not-allowed opacity-65",
              )}
            >
              <input
                id={optionId}
                className="sr-only"
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                disabled={disabled}
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy}
                onChange={() => onChange(option.value)}
                onBlur={onBlur}
              />
              <span className="text-sm font-semibold text-ink">
                {option.label}
              </span>
              {option.description ? (
                <span className="mt-1 text-xs leading-5 text-copy">
                  {option.description}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
      {error ? (
        <p
          id={errorId}
          className="mt-1.5 text-sm leading-5 text-red-700"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

export interface FlowCardProps {
  children: ReactNode;
  className?: string;
  busy?: boolean;
}

export function FlowCard({ children, className, busy }: FlowCardProps) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-line bg-white p-5 shadow-[0_22px_64px_-48px_rgba(11,31,51,0.42)] sm:p-7 lg:p-8",
        className,
      )}
      aria-busy={busy || undefined}
      data-flow-card
    >
      {children}
    </section>
  );
}

export interface IntakeProgressStep {
  readonly label: string;
}

export interface IntakeProgressProps {
  current: number;
  total?: number;
  label?: string;
  steps?: readonly (string | IntakeProgressStep)[];
  ariaLabel?: string;
  stepsAriaLabel?: string;
}

export function IntakeProgress({
  current,
  total,
  label = "Step",
  steps,
  ariaLabel = "Appraisal progress",
  stepsAriaLabel = "Appraisal steps",
}: IntakeProgressProps) {
  const resolvedTotal = steps?.length ?? total ?? 3;
  const renderedTotal = Math.max(resolvedTotal, 3);
  const defaultLabels =
    resolvedTotal === 2 ? ["Start", "Report"] : ["Start", "Vehicle", "Claim"];
  const stepDescriptors = Array.from({ length: resolvedTotal }, (_, index) => {
    const descriptor = steps?.[index];
    if (typeof descriptor === "string") {
      return { label: descriptor };
    }
    if (descriptor) {
      return descriptor;
    }
    const fallback = defaultLabels[index] ?? label;
    return { label: fallback };
  });

  return (
    <div aria-label={ariaLabel}>
      <ol
        className="relative h-[18px] overflow-hidden"
        aria-label={stepsAriaLabel}
      >
        {Array.from({ length: renderedTotal }, (_, index) => {
          const step = index + 1;
          const descriptor = stepDescriptors[index] ?? { label };
          const visible = step <= resolvedTotal;
          const completed = step < current;
          const active = step === current;
          return (
            <li
              key={step}
              data-intake-progress-segment={step}
              data-visible={visible}
              className={cn(
                "intake-progress-segment absolute inset-y-0 min-w-0 rounded-xl border",
                completed && "border-brand bg-brand",
                active &&
                  "border-brand bg-brand shadow-[0_8px_24px_-18px_rgba(21,94,239,0.8)]",
                step > current && "border-line bg-surface/75",
                !visible && "pointer-events-none opacity-0",
              )}
              style={intakeProgressSegmentStyle(index, resolvedTotal)}
              aria-current={active && visible ? "step" : undefined}
              aria-hidden={visible ? undefined : true}
              aria-label={
                visible
                  ? `${descriptor.label}, step ${step}${completed ? ", completed" : active ? ", current" : ""}`
                  : undefined
              }
            />
          );
        })}
      </ol>
    </div>
  );
}

function intakeProgressSegmentStyle(
  index: number,
  total: number,
): CSSProperties {
  if (index >= total) {
    return { left: "100%", width: "0px" };
  }

  const gap = 8;
  const widthPercent = roundCssNumber(100 / total);
  const widthGapShare = roundCssNumber((gap * (total - 1)) / total);
  const leftPercent = roundCssNumber((100 * index) / total);
  const leftGapShare = roundCssNumber((gap * index) / total);

  return {
    left:
      index === 0
        ? "0px"
        : `calc(${leftPercent}% + ${leftGapShare}px)`,
    width: `calc(${widthPercent}% - ${widthGapShare}px)`,
  };
}

function roundCssNumber(value: number) {
  return Number(value.toFixed(4));
}

export interface StepHeadingProps {
  title: ReactNode;
  description: ReactNode;
  className?: string;
}

export function StepHeading({
  title,
  description,
  className,
}: StepHeadingProps) {
  return (
    <div className={cn("mt-7 border-b border-line pb-6", className)}>
      <h2
        className="text-2xl font-semibold tracking-[-0.03em] text-ink sm:text-3xl"
        tabIndex={-1}
      >
        {title}
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-copy">
        {description}
      </p>
    </div>
  );
}

export interface StepActionsProps {
  onBack?: () => void;
  onContinue: () => void;
  busy?: boolean;
  continueLabel?: string;
  backLabel?: string;
  continueDisabled?: boolean;
  backDisabled?: boolean;
}

export function StepActions({
  onBack,
  onContinue,
  busy,
  continueLabel = "Continue",
  backLabel = "Back",
  continueDisabled,
  backDisabled,
}: StepActionsProps) {
  return (
    <div
      className={cn(
        "mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center",
        onBack ? "sm:justify-between" : "sm:justify-end",
      )}
    >
      {onBack ? (
        <button
          type="button"
          className={secondaryFlowButtonClassName}
          disabled={busy || backDisabled}
          onClick={onBack}
        >
          <ArrowLeft className="size-4" aria-hidden />
          {backLabel}
        </button>
      ) : null}
      <button
        type="button"
        className={primaryFlowButtonClassName}
        disabled={busy || continueDisabled}
        onClick={onContinue}
      >
        {busy ? (
          <LoaderCircle
            className="size-4 animate-spin motion-reduce:animate-none"
            aria-hidden
          />
        ) : null}
        {continueLabel}
        {!busy && continueLabel === "Continue" ? (
          <ArrowRight className="size-4" aria-hidden />
        ) : null}
      </button>
    </div>
  );
}

export function InlineError({ message }: { message: ReactNode }) {
  return (
    <div
      className="mt-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4"
      role="alert"
    >
      <AlertCircle
        className="mt-0.5 size-5 shrink-0 text-red-700"
        aria-hidden
      />
      <p className="text-sm leading-6 text-red-900">{message}</p>
    </div>
  );
}

export interface IntakeStepTransitionProps {
  children: ReactNode;
  direction: "forward" | "backward";
  transitionKey: Key;
}

export function IntakeStepTransition({
  children,
  direction,
  transitionKey,
}: IntakeStepTransitionProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);

  const measure = useCallback(() => {
    const content = contentRef.current;
    if (!content) return;
    const nextHeight = content.scrollHeight;
    if (nextHeight > 0) {
      setMeasuredHeight((current) =>
        current === nextHeight ? current : nextHeight,
      );
    }
  }, []);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(measure);
    return () => window.cancelAnimationFrame(frame);
  }, [measure, transitionKey]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [measure, transitionKey]);

  return (
    <div
      className="transition-[height] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
      style={measuredHeight === null ? undefined : { height: measuredHeight }}
      data-intake-transition-shell
    >
      <div
        ref={contentRef}
        key={transitionKey}
        className={
          direction === "forward"
            ? "intake-step-forward"
            : "intake-step-backward"
        }
        data-intake-transition={direction}
      >
        {children}
      </div>
    </div>
  );
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function canMoveToNextMonth(visibleMonth: Date, today: Date) {
  return addMonths(visibleMonth, 1).getTime() <= startOfMonth(today).getTime();
}

function daysForCalendarMonth(visibleMonth: Date) {
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const dayCount = new Date(year, month + 1, 0).getDate();
  return [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from(
      { length: dayCount },
      (_, index) => new Date(year, month, index + 1),
    ),
  ];
}

function parseIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, monthIndex, day);
  return date.getFullYear() === year &&
    date.getMonth() === monthIndex &&
    date.getDate() === day
    ? date
    : null;
}

function toIsoDate(date: Date) {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function sameLocalDate(left: Date | null, right: Date | null) {
  return Boolean(
    left &&
    right &&
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate(),
  );
}

function formatDateLabel(value: string) {
  const date = parseIsoDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export const primaryFlowButtonClassName =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-brand px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none";

export const secondaryFlowButtonClassName =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-line bg-white px-5 text-sm font-semibold text-ink transition-colors hover:border-brand/35 hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none";
