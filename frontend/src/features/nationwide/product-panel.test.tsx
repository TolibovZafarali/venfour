import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductFactsForm, ProductInspection, type SaveProductFacts } from "./product-panel";
import type * as ProductApi from "./product-api";
import { confirmedValues, updatedFacts, type ProductResponse, type Facts } from "./product-api";

const api = vi.hoisted(() => ({ loadProduct: vi.fn(), saveProduct: vi.fn() }));
vi.mock("./product-api", async importOriginal => ({ ...await importOriginal<typeof ProductApi>(), ...api }));
const empty: Facts = { schema_version: "1", assertions: [] };
const response: ProductResponse = { context: { case_id: "case", product_version: "2026-09-22.1", facts_revision: 0, facts: empty, candidates: [], conflicts: [], missing_facts: [], review_reasons: [], status: "PRODUCT_REVIEW_REQUIRED", report_label: "Total-Loss Valuation Report", method: "generic_product_method", authority: "not_determined_by_product_configuration", settlement_components: [{component:"sales_tax", status:"unresolved_state_specific_component", note:null}] }, delivery: { state: "held", reasons: ["MISSING_CURRENT_APPROVAL"] }, locations: [{ code: "MO", name: "Missouri" }, { code: "IL", name: "Illinois" }] };
afterEach(() => vi.clearAllMocks());

describe("product fact confirmation", () => {
  it("keeps conflicting document facts and replaces confirmed customer answers", () => {
    const facts: Facts = { schema_version:"1", assertions:[{field:"vehicle_registration",value:"US-MO",provenance:"customer",reference:"old",recorded_at:"old"},{field:"vehicle_registration",value:"US-IL",provenance:"document",reference:"document",recorded_at:"old"}] };
    expect(confirmedValues(facts).vehicle_registration).toBe("");
    const next = updatedFacts(facts, {...confirmedValues(empty), vehicle_registration:"US-MO"}, "now");
    expect(next.assertions).toContainEqual(facts.assertions[1]);
    expect(next.assertions.filter(a => a.field === "vehicle_registration")).toHaveLength(2);
    expect(next.assertions.find(a => a.field === "claim_type")?.value).toBeNull();
  });
  it("requires confirmation and uses an explicit same-state choice, never ZIP", async () => {
    api.loadProduct.mockResolvedValue(response); api.saveProduct.mockResolvedValue(response);
    const saveRef = createRef<SaveProductFacts>();
    render(<ProductFactsForm caseId="case" accessToken="token" saveRef={saveRef} />);
    await screen.findAllByText("Missouri", { selector: "option" });
    await expect(saveRef.current!()).rejects.toThrow("Confirm");
    fireEvent.change(screen.getByLabelText("Vehicle registration state"), {target:{value:"US-MO"}});
    fireEvent.click(screen.getByLabelText(/The vehicle’s home, loss location/));
    expect(screen.queryByLabelText("State where the loss occurred")).toBeNull();
    fireEvent.change(screen.getByLabelText("Whose insurer is handling your claim?"), {target:{value:"first_party"}});
    fireEvent.change(screen.getByLabelText("Vehicle use"), {target:{value:"personal"}});
    fireEvent.click(screen.getByLabelText(/I confirm these answers/));
    await act(async () => { await saveRef.current!(); });
    const submitted = api.saveProduct.mock.calls[0][3] as Facts;
    expect(confirmedValues(submitted)).toEqual({vehicle_registration:"US-MO",garaging_at_loss:"US-MO",loss_location:"US-MO",policy_issued:"US-MO",claim_type:"first_party",policy_use:"personal"});
    expect(api.saveProduct.mock.calls[0].slice(0,3)).toEqual(["case","token",0]);
  });
  it("allows confirmed unknowns and requires reload after stale revisions", async () => {
    api.loadProduct.mockResolvedValue(response); api.saveProduct.mockRejectedValue(new Error("409"));
    render(<ProductFactsForm caseId="case" accessToken="token" />);
    await waitFor(() => expect(screen.getByLabelText(/I confirm these answers/)).toBeEnabled());
    fireEvent.click(screen.getByLabelText(/I confirm these answers/));
    fireEvent.click(screen.getByRole("button", {name:"Save location details"}));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", {name:"Save location details"})).toBeDisabled();
    expect((api.saveProduct.mock.calls[0][3] as Facts).assertions.every(a => a.value === null)).toBe(true);
  });
  it("shows owner product context and hold state separately", async () => {
    api.loadProduct.mockResolvedValue(response);
    render(<ProductInspection caseId="case" accessToken="staff-token" />);
    await screen.findByText("Total-Loss Valuation Report");
    expect(api.loadProduct).toHaveBeenCalledWith("case","staff-token",true);
    expect(screen.getByText("held")).toBeVisible();
    expect(screen.getByText("MISSING_CURRENT_APPROVAL")).toBeVisible();
    expect(screen.getByText(/sales tax: unresolved/)).toBeVisible();
  });
});
