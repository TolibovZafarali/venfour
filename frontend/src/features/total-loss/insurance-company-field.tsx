import { Check, ChevronDown, Search } from "lucide-react";
import { Popover } from "radix-ui";
import { useEffect, useId, useMemo, useRef, useState } from "react";
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
import "@/features/intake/intake-select-menu.css";
import "./insurance-company-field.css";

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
  readonly optional?: boolean;
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
  optional = false,
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
    const search = selection ? "" : query.trim().toLocaleLowerCase();
    const matchingCompanies = commonAutoInsuranceCompanies
      .filter((company) => company.toLocaleLowerCase().includes(search))
      .map((company) => ({ label: company, value: company }));

    return [
      ...matchingCompanies,
      { label: otherInsurerLabel, value: otherInsurerValue },
    ];
  }, [query, selection]);

  useEffect(() => {
    if (open) listboxRef.current?.querySelector('[data-highlighted]')?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

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
    <div className="insurance-company-field">
      <div className="insurance-company-field__label">
        <label htmlFor={id} className="text-sm font-semibold text-ink">
          Insurance company
        </label>
        {optional ? <span className="text-xs text-muted">Optional</span> : null}
      </div>
      <Popover.Root
        open={open && !disabled}
        onOpenChange={(nextOpen) => setOpen(nextOpen && !disabled)}
      >
        <Popover.Anchor asChild>
          <div className="relative">
            <Search
              className="insurance-company-field__search pointer-events-none size-4"
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
              className={cn(totalLossInputClassName, "insurance-company-field__input")}
              onFocus={(event) => {
                event.currentTarget.select();
                setActiveIndex(0);
                setOpen(true);
              }}
              onClick={(event) => {
                if (!open && selection) event.currentTarget.select();
                setActiveIndex(0);
                setOpen(true);
              }}
              onChange={handleSearchChange}
              onKeyDown={handleSearchKeyDown}
              onBlur={handleSearchBlur}
            />
            <ChevronDown
              className={cn(
                "insurance-company-field__chevron pointer-events-none size-4 transition-transform motion-reduce:transition-none",
                open && !disabled && "rotate-180",
              )}
              aria-hidden
            />
          </div>
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content data-product-overlay
            align="start"
            sideOffset={6}
            collisionPadding={12}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            className="intake-select-menu insurance-company-menu"
          >
            <div className="intake-select-menu__heading">Insurance company</div>
            <div
              ref={listboxRef}
              id={listboxId}
              role="listbox"
              aria-label="Insurance companies"
              className="intake-select-options insurance-company-menu__options"
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
                    data-state={selected ? "checked" : "unchecked"}
                    data-highlighted={active ? "" : undefined}
                    data-other={option.value === otherInsurerValue || undefined}
                    className="intake-select-option insurance-company-menu__option"
                    onMouseDown={preserveSearchFocus}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => chooseOption(option)}
                  >
                    <span>{option.label}</span>
                    {selected ? (
                      <span className="intake-select-check"><Check className="size-4" aria-hidden /></span>
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
