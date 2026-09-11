import { useSearchParams } from "react-router";
import { IntakeSelectField, IntakeTextField } from "./intake-fields";
import type { TotalLossManualFormValues, TotalLossManualFormErrors } from "./types";
import { VEHICLE_FACT_FIELDS, VEHICLE_FACT_LABELS, type VehicleFactField } from "./vehicle-facts";

export function VehicleFactFields({ values, errors, onChange, disabled }: {
  values: TotalLossManualFormValues; errors: TotalLossManualFormErrors;
  onChange: (field: keyof TotalLossManualFormValues, value: string) => void; disabled?: boolean;
}) {
  const [parameters] = useSearchParams();
  const requested = parameters.get("vehicleFact");
  const fields = VEHICLE_FACT_FIELDS.filter(field => field === requested || errors[field]);
  if (!fields.length) return null;
  const text = (field: VehicleFactField) => <IntakeTextField
    key={field} id={`total-loss-${field}`} label={VEHICLE_FACT_LABELS[field]} value={values[field] ?? ""}
    onChange={event => onChange(field, event.target.value)} error={errors[field]} disabled={disabled}
    maxLength={200} placeholder="As shown in your vehicle documents" />;
  return <section className="mt-6 space-y-4" aria-label="Confirm vehicle detail">
    <p className="text-sm text-copy">Confirm this detail so we can match the right version of your vehicle. Your other information is saved.</p>
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map(field => field === "drivetrain" ? <IntakeSelectField key={field} id="total-loss-drivetrain" label="Drive type" value={values.drivetrain ?? ""}
        onChange={event => onChange("drivetrain", event.target.value)} error={errors.drivetrain} disabled={disabled}
        placeholder="Choose drive type" options={[
          { value: "FWD", label: "Front-wheel drive" }, { value: "RWD", label: "Rear-wheel drive" },
          { value: "AWD", label: "All-wheel drive" }, { value: "4WD", label: "Four-wheel drive" },
        ]} /> : text(field))}
    </div>
  </section>;
}
