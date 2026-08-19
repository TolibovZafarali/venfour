import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Popover } from "radix-ui";
import { useMemo, useState } from "react";
import type {
  ChangeEventHandler,
  ReactNode,
  Ref,
} from "react";

import { cn } from "@/lib/utils";

export const totalLossInputClassName =
  "mt-2 min-h-12 w-full rounded-lg border border-line bg-white px-3.5 text-base text-ink shadow-sm transition-colors placeholder:text-copy/50 hover:border-line-strong focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/25 disabled:cursor-not-allowed disabled:bg-surface aria-invalid:border-red-500 aria-invalid:ring-red-500/15 motion-reduce:transition-none";

interface IntakeTextFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  error?: string;
  help?: string;
  optional?: boolean;
  type?: "text" | "date";
  inputMode?: "text" | "numeric" | "decimal";
  autoComplete?: string;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  onBlur?: () => void;
}

interface IntakeSelectOption {
  readonly label: string;
  readonly value: string;
}

interface IntakeSelectFieldProps {
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
        <p id={errorId} className="mt-1.5 text-sm leading-5 text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface IntakeDatePickerProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  disabled?: boolean;
  onBlur?: () => void;
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
            <div className="mt-4 grid grid-cols-7 gap-1" role="grid" aria-label="Choose date of loss">
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
        <p id={errorId} className="mt-1.5 text-sm leading-5 text-red-700" role="alert">
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
        {optional ? (
          <span className="text-xs text-copy">Optional</span>
        ) : null}
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
        <p id={errorId} className="mt-1.5 text-sm leading-5 text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface FlowCardProps {
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
    >
      {children}
    </section>
  );
}

interface IntakeProgressProps {
  current: number;
  total?: number;
  label: string;
}

export function IntakeProgress({ current, total, label }: IntakeProgressProps) {
  const resolvedTotal = total ?? 3;

  return (
    <div aria-label="Appraisal progress">
      <div className="flex items-center justify-between gap-4 text-xs font-semibold tracking-[0.08em] text-copy uppercase">
        <span>{label}</span>
        <span className="tabular-nums">
          Step {current} of {resolvedTotal}
        </span>
      </div>
      <ol
        className="mt-3 grid h-2 grid-flow-col auto-cols-fr gap-1 overflow-hidden rounded-full bg-line p-0.5"
        aria-label={`Step ${current} of ${resolvedTotal}`}
      >
        {Array.from({ length: resolvedTotal }, (_, index) => {
          const step = index + 1;
          return (
            <li
              key={step}
              className={cn(
                "rounded-full bg-white/70 transition-colors duration-300 motion-reduce:transition-none",
                step <= current && "bg-brand",
              )}
              aria-current={step === current ? "step" : undefined}
              aria-label={`Step ${step}${step < current ? ", completed" : step === current ? ", current" : ""}`}
            />
          );
        })}
      </ol>
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
    ...Array.from({ length: dayCount }, (_, index) =>
      new Date(year, month, index + 1),
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
