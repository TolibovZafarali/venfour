import { describe, expect, it } from "vitest";
import { loadStateGuide } from "./guide-loader";
import { states, stateMetadata } from "./states";

async function guideText(code: string) {
  const guide = await loadStateGuide(states.find(state => state.code === code)!);
  return [...guide.valuation, ...guide.rules.flatMap(rule => rule.paragraphs), ...guide.reconsideration, ...guide.faqs.flatMap(faq => faq.paragraphs)].map(paragraph => paragraph.text).join(" ");
}

describe("state guide content", () => {
  it("has one content module per supported jurisdiction", () => {
    const modules = Object.keys(import.meta.glob("./guides/*.ts")).sort();
    expect(modules).toEqual(states.map(state => `./guides/${state.slug}.ts`).sort());
  });

  it.each(states)("loads $name with complete citations and matching metadata", async state => {
    const guide = await loadStateGuide(state);
    expect(guide.code).toBe(state.code);
    expect(guide.description).toBe(stateMetadata(state).description);
    expect(guide.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const checked = new Date(`${guide.checkedOn}T00:00:00Z`);
    expect(checked.toISOString().slice(0, 10)).toBe(guide.checkedOn);
    expect(checked.getTime()).toBeLessThanOrEqual(Date.now());
    expect(guide.valuation.length).toBeGreaterThan(0);
    expect(guide.rules.length).toBeGreaterThan(0);
    expect(guide.reconsideration.length).toBeGreaterThan(0);
    expect(guide.faqs.length).toBeGreaterThanOrEqual(2);
    expect(guide.sources.length).toBeGreaterThanOrEqual(2);
    expect(new Set(guide.rules.map(rule => rule.title)).size).toBe(guide.rules.length);
    expect(new Set(guide.faqs.map(faq => faq.title)).size).toBe(guide.faqs.length);
    const paragraphs = [...guide.valuation, ...guide.rules.flatMap(rule => rule.paragraphs), ...guide.reconsideration, ...guide.faqs.flatMap(faq => faq.paragraphs)];
    const sources = new Map(guide.sources.map(source => [source.id, source]));
    expect(sources.size).toBe(guide.sources.length);
    const referenced = new Set<string>();
    for (const paragraph of paragraphs) {
      expect(paragraph.text.trim()).not.toBe("");
      expect(paragraph.text).not.toMatch(/<\/?(?:p|a|strong)\b|TODO|TBD/);
      for (const id of paragraph.sources ?? []) {
        expect(sources.has(id), `${state.code}: missing ${id}`).toBe(true);
        referenced.add(id);
      }
    }
    for (const source of guide.sources) {
      expect(referenced.has(source.id), `${state.code}: unused ${source.id}`).toBe(true);
      expect(new URL(source.url).protocol).toBe("https:");
      expect(source.title.trim()).not.toBe("");
      expect(source.locator.trim()).not.toBe("");
      expect(source.applicability.trim()).not.toBe("");
      expect(source.claims.length).toBeGreaterThan(0);
      expect(source.checkedOn).toBe(guide.checkedOn);
      if (state.code !== "MO") expect(new URL(source.url).hostname).not.toMatch(/(^|\.)mo\.gov$/);
    }
    if (state.code !== "MO") {
      expect(paragraphs.map(p => p.text).join(" ")).not.toContain("Missouri");
    }
  });

  it("retains consequential pilot qualifications", async () => {
    const texas = await guideText("TX");
    expect(texas).toContain("on or after January 1, 2026");
    expect(texas).toContain("Commercial policies are excluded");
    expect(texas).toContain("another person’s insurer");
    expect(texas).toContain("cannot be deducted");
    const california = await guideText("CA");
    expect(california).toContain("above $7,500");
    expect(california).toContain("above $2,000");
    expect(california).toContain("claims against another person’s insurer are excluded");
    const district = await guideText("DC");
    expect(district).toContain("exceeds 75%");
    expect(district).toContain("Historic motor vehicles are excluded");
    expect(district).toContain("within 30 days of the damage");
  });

  it("keeps state-specific deadlines and title tests qualified", async () => {
    const hawaii = await guideText("HI");
    expect(hawaii).toContain("purchasing a replacement within 30 days after receipt");
    expect(hawaii).toContain("cash settlement under your own policy");
    expect(hawaii).toContain("within 33 days after receipt");
    expect(hawaii).toContain("within 10 days after the settlement date");
    expect(hawaii).toContain("notify the owner in writing");
    const kentucky = await guideText("KY");
    expect(kentucky).toContain("35 days after receiving the settlement check");
    expect(kentucky).toContain("Monday through Friday, excluding holidays");
    expect(kentucky).toContain("exceeding 75%");
    const florida = await guideText("FL");
    expect(florida).toContain("applies to an uninsured vehicle");
    expect(florida).toContain("written explanation must be supplied if requested");
    const arkansas = await guideText("AR");
    expect(arkansas).toContain("voluntary and nonbinding");
    const connecticut = await guideText("CT");
    expect(connecticut).toContain("commissioner-approved source, and one other approved industry source");
    expect(connecticut).toContain("Coverage and liability must be undisputed");
    const delaware = await guideText("DE");
    expect(delaware).toContain("30 days after titling");
  });
  it("preserves age, coverage, and availability qualifications", async () => {
    const massachusetts = await guideText("MA");
    expect(massachusetts).toContain("Passenger vehicles at least ten years old");
    expect(massachusetts).toContain("does not itself extend coverage");
    const minnesota = await guideText("MN");
    expect(minnesota).toContain("excluding automobile dealers");
    expect(minnesota).toContain("comparable local vehicle if available");
    expect(minnesota).toContain("at least prorated");
    expect(minnesota).toContain("Recovered intact vehicles are excluded");
    const mississippi = await guideText("MS");
    expect(mississippi).toContain("at least ten years old worth $1,500 or less");
    expect(mississippi).toContain("five or fewer minor component parts");
  });

  it("keeps settlement, title, and replacement-purchase clocks distinct", async () => {
    const nebraska = await guideText("NE");
    expect(nebraska).toContain("60 days after the settlement date");
    const newHampshire = await guideText("NH");
    expect(newHampshire).toContain("20 days after receiving settlement payment");
    expect(newHampshire).toContain("location and VIN in writing");
    const newYork = await guideText("NY");
    expect(newYork).toContain("35 days from the date the settlement check was mailed");
    const northDakota = await guideText("ND");
    expect(northDakota).toContain("insurance compensation plus the deductible");
    expect(northDakota).toContain("three years from the statement’s issuance");
    const ohio = await guideText("OH");
    expect(ohio).toContain("first- or third-party cash settlements");
    expect(ohio).toContain("33 days after receiving that payment");
    expect(ohio).toContain("35 days after you receive the settlement");
  });

  it("does not generalize jurisdiction-specific title or appraisal rules", async () => {
    const nevada = await guideText("NV");
    expect(nevada).toContain("exceeding 65%");
    expect(nevada).toContain("excluding painting");
    expect(nevada).toContain("at least 10 model years old");
    const oregon = await guideText("OR");
    expect(oregon).toContain("at least 80%");
    expect(oregon).toContain("applies to damage not covered by insurance");
    const rhodeIsland = await guideText("RI");
    expect(rhodeIsland).toContain("fair market value before deductions");
    expect(rhodeIsland).toContain("involving an insured or claimant");
    expect(rhodeIsland).toContain("repairable Class B vehicles");
    const southDakota = await guideText("SD");
    expect(southDakota).toContain("requires both parties to agree");
    expect(southDakota).toContain("cannot bind either side");
    const washington = await guideText("WA");
    expect(washington).toContain("first-party physical-damage coverage");
    expect(washington).toContain("issued or renewed effective on or after January 1, 2026");
    const wisconsin = await guideText("WI");
    expect(wisconsin).toContain("less than seven years old with non-hail damage");
    expect(wisconsin).toContain("more than 70%");
  });
});
