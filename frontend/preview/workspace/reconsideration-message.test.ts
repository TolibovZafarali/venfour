import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import copy from "../../../templates/total-loss-reconsideration-email.json";
import { describe, expect, it } from "vitest";
import fixture from "../../../tests/fixtures/reconsideration-email.json";
import { renderReconsiderationPreview } from "./reconsideration-message";
import type { ReconsiderationPreviewFacts } from "./reconsideration-message";

const facts: ReconsiderationPreviewFacts = {
  claimNumber: "CLM-42", adjusterName: "Alex Morgan", yearMakeModel: "2022 Honda Accord", trim: "EX-L",
  insurerAmountMinorUnits: 1800045, customerName: "Jordan Rivera", customerPhone: "+1 (312) 555-0102",
  findingCode: "CCC_BELOW_EXTERNAL_RANGE",
};
const variants = [
  ["complete case", {}],
  ["missing adjuster name", { adjusterName: null }],
  ["missing claim number", { claimNumber: null }],
  ["missing trim", { trim: null }],
  ["missing customer phone", { customerPhone: null }],
] as const;

function assertEmail(email: { subject: string; body: string }, input: ReconsiderationPreviewFacts) {
  expect(email.body).not.toMatch(/venfour|null|undefined|unavailable|\{\{|\}\}|\[[^\]]+\]|%s/iu);
  expect(email.body).toContain("$18,000.45 valuation for my 2022 Honda Accord");
  expect(email.body).not.toMatch(/\$20,000|\$21,000|\$22,000|\$999,999|selling prices|after accounting for/iu);
  expect(email.body).toContain("please send me the updated valuation report");
  expect(email.body).toContain("a brief explanation of the difference");
  expect(email.body.split(/\s+/u).length).toBeLessThan(170);
  expect(email.subject).toBe(input.claimNumber ? "Vehicle valuation review — Claim CLM-42" : "Vehicle valuation review — 2022 Honda Accord");
  expect(email.body.startsWith(input.adjusterName ? "Hi Alex,\n" : "Hello,\n")).toBe(true);
  expect(email.body.includes("EX-L")).toBe(Boolean(input.trim));
  expect(email.body.includes("+1 (312) 555-0102")).toBe(Boolean(input.customerPhone));
}

describe("canonical reconsideration preview copy", () => {
  it("keeps the deployed template snapshot synchronized with the shared copy", () => {
    const migration = readFileSync("../supabase/migrations/20260916000100_total_loss_reconsideration_template.sql", "utf8");
    expect(JSON.parse(migration.match(/\$copy\$([\s\S]*?)\$copy\$/u)![1])).toEqual(copy);
  });
  it.each(variants)("renders %s without inventing a dollar target", (_name, changes) => {
    const input = { ...facts, ...changes };
    assertEmail(renderReconsiderationPreview(input), input);
  });
  it("uses Hello for initials or a title instead of guessing a first name", () => {
    for (const adjusterName of ["A. Morgan", "Mr. Morgan", "Claims Representative"]) {
      expect(renderReconsiderationPreview({ ...facts, adjusterName }).body).toMatch(/^Hello,/u);
    }
  });
});

// Explicitly opt in to the local-only database; never uses hosted credentials.
describe.skipIf(process.env.VENFOUR_LOCAL_EMAIL_PARITY !== "1")("stored report email generation", () => {
  const generate = (input: typeof fixture) => {
    const args = [input.report, input.details, input.contact].map(value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`);
    const output = execFileSync("docker", ["exec", "-i", "supabase_db_venfour", "psql", "-U", "supabase_admin", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1"], {
      input: `select public.build_total_loss_reconsideration_email_internal(${args.join(",")});`, encoding: "utf8",
    });
    return JSON.parse(output) as { subject: string; body: string; templateVersion: string };
  };
  it.each(variants)("matches the preview byte for byte for %s", (_name, changes) => {
    const input = { ...facts, ...changes };
    const saved = structuredClone(fixture);
    saved.details = { claimReference: input.claimNumber!, adjusterName: input.adjusterName! };
    saved.contact.phone_number = input.customerPhone!;
    if (!input.trim) saved.report.subjectVehicle.facts = saved.report.subjectVehicle.facts.filter(row => row.key !== "trim");
    const actual = generate(saved);
    assertEmail(actual, input);
    expect(actual).toEqual({ ...renderReconsiderationPreview(input), templateVersion: "initial-reconsideration-v3" });
  });
  it("selects the strongest supported finding regardless of source order", () => {
    const actual = generate(fixture);
    expect(actual.body).toContain("below the advertised prices");
    expect(actual.body).not.toContain("median");
    expect(actual.body).not.toContain("adjustments reduced");
    const saved = structuredClone(fixture);
    saved.report.findings.find(row => row.code === "CCC_BELOW_EXTERNAL_RANGE")!.evidenceIds = ["unknown-evidence"];
    expect(generate(saved).body).toContain("below the median advertised price");
  });
  it("does not invent trim errors or copy unsupported finding prose", () => {
    const saved = structuredClone(fixture);
    saved.report.findings = [{ code: "TRIM_ERROR", evidenceLabel: "DETERMINISTIC_FINDING", evidenceIds: ["unknown"] }];
    const body = generate(saved).body;
    expect(body).not.toMatch(/trim error|incorrect|confirms|below the advertised|median/iu);
  });
  it("omits unverified trim and placeholders rather than parsing the display description", () => {
    const saved = structuredClone(fixture);
    saved.report.subjectVehicle.facts.find(row => row.key === "trim")!.evidenceIds = [];
    saved.details = { claimReference: "[claim number]", adjusterName: "undefined" };
    saved.contact.phone_number = "null";
    const actual = generate(saved);
    expect(actual.subject).toBe("Vehicle valuation review — 2022 Honda Accord");
    expect(actual.body).toMatch(/^Hello,/u);
    expect(actual.body).not.toMatch(/UNVERIFIED|EX-L|null|undefined|\[claim/iu);
  });
  it("never turns the market median or unrecognized target fields into a requested value", () => {
    const saved = structuredClone(fixture);
    Object.assign(saved.report.executiveConclusion, { supportedVehicleValue: 2100000, pointAcvDetermined: true });
    saved.report.executiveConclusion.supportedAdvertisedPriceRange.median.minorUnits = 9999900;
    expect(generate(saved).body).toBe(generate(fixture).body);
  });
  it("omits brand mentions and unresolved placeholders from dynamic fields", () => {
    const saved = structuredClone(fixture);
    saved.contact.first_name = "Venfour";
    saved.contact.last_name = "[customer name]";
    saved.contact.full_name = "Venfour Support";
    saved.contact.phone_number = "{phone}";
    saved.details = { claimReference: "<claim>", adjusterName: "Venfour team" };
    const actual = generate(saved);
    expect(actual.body).not.toMatch(/venfour|[<>{}[\]]|null|undefined/iu);
    expect(actual.body).not.toMatch(/Best,/u);
  });
  it("does not expose template or generator functions to customer roles", () => {
    const output = execFileSync("docker", ["exec", "supabase_db_venfour", "psql", "-U", "supabase_admin", "-d", "postgres", "-Atc",
      "select has_function_privilege('authenticated','public.build_total_loss_reconsideration_email_internal(jsonb,jsonb,jsonb)','execute') or has_function_privilege('anon','public.total_loss_reconsideration_template_internal()','execute')"], { encoding: "utf8" });
    expect(output.trim()).toBe("f");
  });
});
