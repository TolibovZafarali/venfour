import { useId, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VEHICLE_FACT_LABELS, type VehicleFactField } from "@/features/total-loss/vehicle-facts";

export function VehicleDetailQuestion({ field, onConfirm }: {
  field: VehicleFactField;
  onConfirm: (field: VehicleFactField, value: string) => Promise<void>;
}) {
  const id = useId();
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = VEHICLE_FACT_LABELS[field];
  return <form className="vehicle-detail-question" onSubmit={async event => {
    event.preventDefault();
    if (pending) return;
    const answer = value.trim();
    if (!answer || /^(?:unknown|not sure|other|n\/a|none|-)$/iu.test(answer)) {
      setError(`Enter the ${label.toLowerCase()} shown in your vehicle documents, or continue with your saved report.`);
      return;
    }
    setPending(true);
    setError(null);
    try { await onConfirm(field, answer); }
    catch { setError("We couldn’t save this detail. Your existing information is safe. Try again or review your saved details."); }
    finally { setPending(false); }
  }}>
    {field === "drivetrain" ? <fieldset className="vehicle-detail-question__choices" disabled={pending} aria-describedby={`${id}-help`}>
      <legend>{label}</legend>
      <p id={`${id}-help`}>Choose the drive type shown in your vehicle documents.</p>
      <div className="vehicle-detail-question__options">
        {([["FWD", "Front-wheel drive"], ["RWD", "Rear-wheel drive"], ["AWD", "All-wheel drive"], ["4WD", "Four-wheel drive"]] as const).map(([code, name]) => <label key={code} className="vehicle-detail-question__option">
          <input type="radio" name={id} aria-label={`${name} (${code})`} value={code} checked={value === code} onChange={event => setValue(event.target.value)} required />
          <span className="vehicle-detail-question__code">{code}</span>
          <span className="vehicle-detail-question__name">{name}</span>
          <span className="vehicle-detail-question__indicator" aria-hidden><Check /></span>
        </label>)}
      </div>
    </fieldset> : <>
      <label htmlFor={id}>{label}</label>
      <input id={id} value={value} onChange={event => setValue(event.target.value)} disabled={pending} required maxLength={200} aria-describedby={`${id}-help`} placeholder="As shown in your vehicle documents" />
      <p id={`${id}-help`}>Use the detail shown in your vehicle documents.</p>
    </>}
    {error ? <p role="alert">{error}</p> : null}
    <Button type="submit" size="lg" disabled={pending}>{pending ? "Saving…" : "Save and check again"}<ArrowRight aria-hidden /></Button>
  </form>;
}
