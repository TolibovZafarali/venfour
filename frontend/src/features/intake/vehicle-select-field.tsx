import { Check, ChevronDown, ChevronUp, LoaderCircle } from "lucide-react";
import { Select } from "radix-ui";

import type { IntakeSelectFieldProps } from "@/features/total-loss/intake-fields";

type VehicleSelectFieldProps = Omit<IntakeSelectFieldProps, "onChange"> & {
  onChange: (value: string) => void;
};

export function VehicleSelectField({ id, label, value, options, placeholder, disabled, loading, error, onChange, onBlur }: VehicleSelectFieldProps) {
  const items = options.map(option => typeof option === "string" ? { label: option, value: option } : option);
  const selected = items.find(option => option.value === value);
  return (
    <div data-intake-select-field data-filled={Boolean(value) || undefined}>
      <div className="flex items-baseline justify-between gap-3">
        <label id={`${id}-label`} htmlFor={id} className="text-sm font-semibold text-ink">{label}</label>
      </div>
      <Select.Root value={value} onValueChange={onChange} disabled={disabled || loading} name={id}>
        <Select.Trigger id={id} value={value} data-vehicle-select-trigger aria-labelledby={`${id}-label`} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} onBlur={event => {
          if (event.currentTarget.getAttribute("aria-expanded") !== "true") onBlur?.();
        }}>
          <Select.Value placeholder={loading ? "Loading…" : placeholder}>{selected?.label}</Select.Value>
          <Select.Icon className="vehicle-select-icon">
            {loading ? <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" /> : <ChevronDown className="size-4" />}
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="vehicle-select-menu" aria-label={`${label} options`} position="popper" sideOffset={6} collisionPadding={12} onCloseAutoFocus={() => onBlur?.()}>
            <div className="vehicle-select-menu__heading">{label}</div>
            <Select.ScrollUpButton className="vehicle-select-scroll"><ChevronUp className="size-4" /></Select.ScrollUpButton>
            <Select.Viewport className="vehicle-select-options">
              {items.map(option => (
                <Select.Item key={option.value} value={option.value} textValue={option.label} className="vehicle-select-option">
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator className="vehicle-select-check"><Check className="size-4" /></Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
            <Select.ScrollDownButton className="vehicle-select-scroll"><ChevronDown className="size-4" /></Select.ScrollDownButton>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
      {error ? <p id={`${id}-error`} className="mt-1.5 text-sm leading-5 text-red-700" role="alert">{error}</p> : null}
    </div>
  );
}
