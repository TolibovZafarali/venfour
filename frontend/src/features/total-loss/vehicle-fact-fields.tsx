import { IntakeSelectField, IntakeTextField } from "./intake-fields";
import type { TotalLossManualFormValues, TotalLossManualFormErrors } from "./types";
import { VEHICLE_FACT_LABELS, type VehicleFactField } from "./vehicle-facts";

export function VehicleFactFields({ values, errors, onChange, disabled }: {
  values: TotalLossManualFormValues; errors: TotalLossManualFormErrors;
  onChange: (field: keyof TotalLossManualFormValues, value: string) => void; disabled?: boolean;
}) {
  const truck = ["truck", "pickup", "pickup truck"].includes(values.bodyType?.toLowerCase() ?? "");
  const text = (field: VehicleFactField, placeholder: string, optional = false) => <IntakeTextField
    key={field} id={`total-loss-${field}`} label={VEHICLE_FACT_LABELS[field]} value={values[field] ?? ""}
    onChange={event => onChange(field, event.target.value)} error={errors[field]} disabled={disabled}
    maxLength={200} placeholder={placeholder} optional={optional} />;
  return <section className="mt-6 space-y-4" aria-label="Vehicle details for matching">
    <p className="text-sm text-copy">Available vehicle details are filled in for you. Add anything missing from your valuation report, window sticker, or vehicle documents, and correct anything that looks wrong.</p>
    <div className="grid gap-4 sm:grid-cols-2">
      {text("bodyType", "For example, Sedan or SUV")}
      <IntakeSelectField id="total-loss-drivetrain" label="Drive type" value={values.drivetrain ?? ""}
        onChange={event => onChange("drivetrain", event.target.value)} error={errors.drivetrain} disabled={disabled}
        placeholder="Choose drive type" options={[
          { value: "FWD", label: "Front-wheel drive" }, { value: "RWD", label: "Rear-wheel drive" },
          { value: "AWD", label: "All-wheel drive" }, { value: "4WD", label: "Four-wheel drive" },
        ]} />
      {text("engine", "For example, 2.0L I4 or electric motor")}
      {text("fuelType", "As shown in your vehicle documents")}
      {text("transmission", "For example, Automatic")}
      {truck ? <>{text("cabType", "For example, Crew Cab")}{text("bedLength", "As shown in your vehicle documents")}</> : null}
    </div>
    <details><summary className="cursor-pointer text-sm font-medium">Additional vehicle details, if known</summary>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {text("doors", "Number of doors", true)}{text("cylinders", "Number of cylinders", true)}
        {text("bodySubtype", "Body configuration", true)}{text("powertrain", "Exact powertrain description", true)}
      </div>
    </details>
  </section>;
}
