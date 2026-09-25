import { useEffect, useId, useState, type MutableRefObject } from "react";
import { Button } from "@/components/ui/button";
import { confirmedValues, loadProduct, saveProduct, updatedFacts, type FactField, type ProductResponse } from "./product-api";

export type SaveProductFacts = () => Promise<void>;
const labels: Record<FactField, string> = { vehicle_registration: "Vehicle registration state", garaging_at_loss: "Vehicle home state at the time of loss", loss_location: "State where the loss occurred", policy_issued: "State where the policy was issued", claim_type: "Whose insurer is handling your claim?", policy_use: "Vehicle use" };
const readable = (value: string) => value.toLowerCase().replaceAll("_", " ");

type ProductFormProps = { caseId: string; accessToken: string; saveRef?: MutableRefObject<SaveProductFacts | null>; onSaved?: () => void; onReadyChange?: (ready: boolean) => void };
export function ProductFactsForm(props: ProductFormProps) {
  return <ProductFactsFormContent key={props.caseId} {...props} />;
}
function ProductFactsFormContent({ caseId, accessToken, saveRef, onSaved, onReadyChange }: ProductFormProps) {
  const id = useId();
  const [data, setData] = useState<ProductResponse | null>(null);
  const [values, setValues] = useState<Record<FactField, string>>(() => confirmedValues({ schema_version: "1", assertions: [] }));
  const [same, setSame] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [saved, setSaved] = useState(false);
  const ready = Boolean(data && confirmed && !busy);
  useEffect(() => {
    onReadyChange?.(ready);
    return () => onReadyChange?.(false);
  }, [onReadyChange, ready]);
  useEffect(() => {
    let current = true;
    void loadProduct(caseId, accessToken).then(value => {
      if (current) { setData(value); setValues(confirmedValues(value.context.facts)); setConfirmed(false); }
    }).catch(() => { if (current) setError("We could not load your saved location details. Reload to try again."); });
    return () => { current = false; };
  }, [caseId, accessToken, reload]);
  const save: SaveProductFacts = async () => {
    if (!data || !confirmed || busy) throw new Error("Confirm the location and claim details before continuing. Unknown details may stay unknown.");
    setBusy(true); setError(null);
    try {
      const result = await saveProduct(caseId, accessToken, data.context.facts_revision, updatedFacts(data.context.facts, values, new Date().toISOString()));
      setData(result); setSaved(true); onSaved?.();
    } catch {
      const message = "These details could not be saved. Another session may have changed them. Reload and confirm the latest details.";
      setError(message); setConfirmed(false); throw new Error(message);
    } finally { setBusy(false); }
  };
  useEffect(() => {
    if (saveRef) saveRef.current = save;
    return () => { if (saveRef) saveRef.current = null; };
  });
  const change = (field: FactField, value: string) => {
    setConfirmed(false); setSaved(false);
    setValues(previous => ({ ...previous, [field]: value, ...(same && field === "vehicle_registration" ? { garaging_at_loss: value, loss_location: value, policy_issued: value } : {}) }));
  };
  const select = (field: FactField) => <label key={field} className="grid gap-2 text-sm" htmlFor={`${id}-${field}`}>
    <span className="font-medium">{labels[field]}</span>
    <select id={`${id}-${field}`} value={values[field]} disabled={busy || !data} onChange={event => change(field, event.target.value)} className="min-h-11 rounded-md border border-border bg-white px-3 text-foreground">
      <option value="">I don’t know yet</option>
      {field === "claim_type" ? <><option value="first_party">My insurer (first-party claim)</option><option value="third_party">Another person’s insurer (third-party claim)</option></> : field === "policy_use" ? <><option value="personal">Personal</option><option value="commercial">Commercial</option></> : <>
        {data?.locations.map(location => <option key={location.code} value={`US-${location.code}`}>{location.name}</option>)}
        <option value="US-PR">Puerto Rico</option><option value="US-GU">Guam</option><option value="US-VI">U.S. Virgin Islands</option><option value="US-AS">American Samoa</option><option value="US-MP">Northern Mariana Islands</option><option value="OUTSIDE_US">Outside the United States</option>
        {values[field] && !data?.locations.some(l => `US-${l.code}` === values[field]) && !["US-PR", "US-GU", "US-VI", "US-AS", "US-MP", "OUTSIDE_US"].includes(values[field]) ? <option value={values[field]}>{values[field]}</option> : null}
      </>}
    </select>
  </label>;
  return <section className="my-6 grid gap-4 border-t border-border pt-5" aria-label="Location and claim details" data-intake-incomplete={!data || !confirmed || busy}>
    <div><h2 className="font-semibold">Location and claim details</h2><p className="mt-1 text-sm text-muted-foreground">Use the details at the time of loss. Your search ZIP locates comparable vehicles; it does not fill in these answers.</p></div>
    {select("vehicle_registration")}
    <label className="flex gap-3 text-sm"><input type="checkbox" checked={same} disabled={busy || !data || !values.vehicle_registration} onChange={event => {
      const checked = event.target.checked; setSame(checked); setConfirmed(false); setSaved(false);
      if (checked) setValues(previous => ({ ...previous, garaging_at_loss: previous.vehicle_registration, loss_location: previous.vehicle_registration, policy_issued: previous.vehicle_registration }));
    }} />The vehicle’s home, loss location, and policy issue state are the same as its registration state.</label>
    {!same && <div className="grid gap-4 sm:grid-cols-2">{select("garaging_at_loss")}{select("loss_location")}{select("policy_issued")}</div>}
    <div className="grid gap-4 sm:grid-cols-2">{select("claim_type")}{select("policy_use")}</div>
    {data?.context.conflicts.length ? <div role="status" className="text-sm"><p>Saved sources disagree about: {data.context.conflicts.map(readable).join(", ")}. Confirm your answer; the differing source remains available for review.</p><ul>{data.context.facts.assertions.filter(a => data.context.conflicts.includes(a.field)).map((a, i) => <li key={i}>{labels[a.field as FactField] ?? readable(a.field)}: {a.value ?? "unknown"} ({a.provenance})</li>)}</ul></div> : null}
    {data && (data.context.candidates.length > 1 || data.context.status === "PRODUCT_UNSUPPORTED") ? <p role="status" className="text-sm">These locations need review before state-specific information can be applied. We have not selected one state over another.</p> : null}
    <label className="flex gap-3 text-sm"><input type="checkbox" checked={confirmed} disabled={busy || !data} onChange={event => setConfirmed(event.target.checked)} />I confirm these answers, including any details marked unknown.</label>
    {error ? <p role="alert" className="text-sm">{error} <button type="button" className="underline" onClick={() => { setData(null); setConfirmed(false); setSame(false); setError(null); setSaved(false); setReload(v => v + 1); }}>Reload details</button></p> : null}
    {!saveRef && <Button type="button" disabled={!confirmed || busy} onClick={() => void save().catch(() => undefined)}>Save location details</Button>}
    {saved && <p role="status" className="text-sm">Location details saved. Earlier reports keep the facts recorded when they were prepared. Changes may pause new work for review.</p>}
  </section>;
}

export function ProductInspection(props: { caseId: string; accessToken: string }) {
  return <ProductInspectionContent key={props.caseId} {...props} />;
}
function ProductInspectionContent({ caseId, accessToken }: { caseId: string; accessToken: string }) {
  const [data, setData] = useState<ProductResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    void loadProduct(caseId, accessToken, true).then(value => { if (current) setData(value); }).catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [caseId, accessToken, reload]);
  return <section className="admin-panel p-5" aria-label="Nationwide product details"><h2>Nationwide product details</h2>
    <button className="admin-row-link" type="button" onClick={() => { setData(null); setFailed(false); setReload(v => v + 1); }}>Refresh product details</button>
    {failed ? <p role="alert">Product details are unavailable.</p> : !data ? <p>Loading product details…</p> : <>
      <dl className="admin-detail-grid">{Object.entries({ "Report label": data.context.report_label, "Product version": data.context.product_version, "Product status": data.context.status, "Method": data.context.method, "State candidates": data.context.candidates.join(", ") || "Unknown", "Fact revision": data.context.facts_revision, "Conflicts": data.context.conflicts.join(", ") || "None recorded", "Review reasons": data.context.review_reasons.join(", ") || "None recorded", "Authority": data.context.authority, "Delivery": data.delivery?.state ?? "Unavailable", "Hold reasons": data.delivery?.reasons.join(", "), "Recorded authority revision": data.delivery?.authority_revision ?? "None", "Recorded authority expiry": data.delivery?.valid_until ?? "None" }).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
      <p className="text-sm">Product readiness is not operating permission. Delivery status is the recorded hold state; release checks revalidate current authority.</p>
      <h3 className="mt-4 font-semibold">State and claim facts</h3><ul>{data.context.facts.assertions.map((a, i) => <li key={i}>{readable(a.field)}: {a.value ?? "Unknown"} · {a.provenance} · {a.reference}</li>)}</ul>
      <h3 className="mt-4 font-semibold">Separate settlement components</h3><ul>{data.context.settlement_components.map(c => <li key={c.component}>{readable(c.component)}: {readable(c.status)}{c.note ? ` — ${c.note}` : ""}</li>)}</ul>
    </>}
  </section>;
}
