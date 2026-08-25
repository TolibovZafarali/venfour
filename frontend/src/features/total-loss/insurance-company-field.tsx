import { Check, ChevronDown, Search } from "lucide-react";
import { Popover } from "radix-ui";
import { useId, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  FocusEvent,
  KeyboardEvent,
  MouseEvent,
} from "react";

import {
  IntakeTextField,
  totalLossInputClassName,
} from "@/features/total-loss/intake-fields";
import { cn } from "@/lib/utils";

const commonAutoInsuranceCompanies = [
  "State Farm",
  "GEICO",
  "Progressive",
  "Allstate",
  "USAA",
  "Liberty Mutual",
  "Farmers Insurance",
  "Nationwide",
  "American Family Insurance",
  "Travelers",
  "Auto-Owners Insurance",
  "Erie Insurance",
  "AAA / Auto Club",
  "Mercury Insurance",
  "Amica Mutual",
  "Safeco",
  "National General",
  "The Hartford",
  "Kemper",
  "COUNTRY Financial",
  "Shelter Insurance",
  "Root Insurance",
] as const;

const otherInsurerValue = "__other_insurer__";
const otherInsurerLabel = "Other / Not listed";
const commonInsurerNames = new Set<string>(commonAutoInsuranceCompanies);

interface InsuranceCompanyFieldProps {
  readonly id: string;
  readonly value: string;
  readonly error?: string;
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
  readonly onBlur: () => void;
}

interface InsurerOption {
  readonly label: string;
  readonly value: string;
}

function selectionForValue(value: string): string {
  if (commonInsurerNames.has(value)) return value;
  return value ? otherInsurerValue : "";
}

function queryForSelection(selection: string): string {
  return selection === otherInsurerValue ? otherInsurerLabel : selection;
}

export function InsuranceCompanyField({
  id,
  value,
  error,
  disabled,
  onChange,
  onBlur,
}: InsuranceCompanyFieldProps) {
  const initialSelection = selectionForValue(value);
  const [selection, setSelection] = useState(initialSelection);
  const [query, setQuery] = useState(() =>
    queryForSelection(initialSelection),
  );
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const listboxRef = useRef<HTMLDivElement>(null);
  const customInputRef = useRef<HTMLInputElement>(null);
  const suppressNextBlurRef = useRef(false);
  const customInsurer = selection === otherInsurerValue;
  const selectionErrorId = !customInsurer && error ? `${id}-error` : undefined;

  const options = useMemo<readonly InsurerOption[]>(() => {
    const search = query.trim().toLocaleLowerCase();
    const matchingCompanies = commonAutoInsuranceCompanies
      .filter((company) => company.toLocaleLowerCase().includes(search))
      .map((company) => ({ label: company, value: company }));

    return [
      ...matchingCompanies,
      { label: otherInsurerLabel, value: otherInsurerValue },
    ];
  }, [query]);

  const chooseOption = (option: InsurerOption) => {
    setSelection(option.value);
    setQuery(option.label);
    setOpen(false);

    if (option.value === otherInsurerValue) {
      suppressNextBlurRef.current = true;
      onChange("");
      queueMicrotask(() => customInputRef.current?.focus());
      return;
    }

    onChange(option.value);
  };

  const handleSearchChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSelection("");
    setQuery(event.target.value);
    setActiveIndex(0);
    setOpen(true);
    if (value) onChange("");
  };

  const handleSearchBlur = (event: FocusEvent<HTMLInputElement>) => {
    if (suppressNextBlurRef.current) {
      suppressNextBlurRef.current = false;
      return;
    }
    if (
      event.relatedTarget instanceof Node &&
      listboxRef.current?.contains(event.relatedTarget)
    ) {
      return;
    }
    setOpen(false);
    onBlur();
  };

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) =>
        Math.min(current + (open ? 1 : 0), options.length - 1),
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter" && open && options[activeIndex]) {
      event.preventDefault();
      chooseOption(options[activeIndex]);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  };

  const preserveSearchFocus = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  };

  return (
    <div>
      <div className="flex justify-between gap-3 items-baseline">
        <label htmlFor={id} className="text-sm font-semibold text-ink">
          Insurance company
        </label>
      </div>
      <Popover.Root
        open={open && !disabled}
        onOpenChange={(nextOpen) => setOpen(nextOpen && !disabled)}
      >
        <Popover.Anchor asChild>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 mt-1 size-4 -translate-y-1/2 text-copy"
              aria-hidden
            />
            <input
              id={id}
              name={id}
              type="text"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open && !disabled}
              aria-controls={listboxId}
              aria-activedescendant={
                open && !disabled && options[activeIndex]
                  ? `${listboxId}-option-${activeIndex}`
                  : undefined
              }
              aria-invalid={selectionErrorId ? true : undefined}
              aria-describedby={selectionErrorId}
              autoComplete="off"
              value={query}
              placeholder="Search or select insurer"
              disabled={disabled}
              className={cn(totalLossInputClassName, "pl-10 pr-10")}
              onFocus={(event) => {
                event.currentTarget.select();
                setActiveIndex(0);
                setOpen(true);
              }}
              onClick={() => {
                setActiveIndex(0);
                setOpen(true);
              }}
              onChange={handleSearchChange}
              onKeyDown={handleSearchKeyDown}
              onBlur={handleSearchBlur}
            />
            <ChevronDown
              className={cn(
                "pointer-events-none absolute right-3.5 top-1/2 mt-1 size-4 -translate-y-1/2 text-copy transition-transform motion-reduce:transition-none",
                open && !disabled && "rotate-180",
              )}
              aria-hidden
            />
          </div>
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            className="z-50 max-h-64 w-[var(--radix-popover-trigger-width)] min-w-56 overflow-y-auto rounded-xl border border-line bg-white p-1.5 shadow-[0_20px_55px_-24px_rgba(11,31,51,0.42)] outline-none"
          >
            <div
              ref={listboxRef}
              id={listboxId}
              role="listbox"
              aria-label="Insurance companies"
            >
              {options.length === 1 && query.trim() ? (
                <p className="px-3 py-2 text-xs leading-5 text-copy">
                  No matching company found.
                </p>
              ) : null}
              {options.map((option, index) => {
                const selected = selection === option.value;
                const active = activeIndex === index;
                return (
                  <button
                    key={option.value}
                    id={`${listboxId}-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={cn(
                      "flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-brand-soft focus-visible:outline-none motion-reduce:transition-none",
                      active && "bg-brand-soft",
                      option.value === otherInsurerValue &&
                        "mt-1 border-t border-line",
                    )}
                    onMouseDown={preserveSearchFocus}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => chooseOption(option)}
                  >
                    <span>{option.label}</span>
                    {selected ? (
                      <Check className="size-4 shrink-0 text-brand" aria-hidden />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {selectionErrorId ? (
        <p
          id={selectionErrorId}
          className="mt-1.5 text-sm leading-5 text-red-700"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {customInsurer ? (
        <div className="mt-3">
          <IntakeTextField
            id={`${id}-other`}
            label="Insurance company name"
            value={value}
            error={error}
            autoComplete="organization"
            placeholder="Enter insurance company name"
            disabled={disabled}
            inputRef={customInputRef}
            onChange={(event) => onChange(event.target.value)}
            onBlur={onBlur}
          />
        </div>
      ) : null}
    </div>
  );
}
