import { describe, expect, it } from "vitest";
import type { InsurerGuideContent } from "./guide-content";
import { loadInsurerGuide } from "./guide-loader";
import { findInsurer, insurers } from "./insurers";

function paragraphs(guide: InsurerGuideContent) {
  return [
    ...guide.documents, ...guide.valuation, ...guide.reconsideration,
    ...guide.faqs.flatMap(faq => faq.paragraphs),
  ];
}

async function guideText(slug: string) {
  const guide = await loadInsurerGuide(findInsurer(slug)!);
  return paragraphs(guide).map(paragraph => paragraph.text).join(" ");
}

const officialHosts: Record<typeof insurers[number]["slug"], readonly string[]> = {
  "aaa-auto-club-enterprises": [
    "www.ace.aaa.com"
  ],
  "aaa-auto-club-group": [
    "www.acg.aaa.com"
  ],
  "aaa-csaa": [
    "csaa-insurance.aaa.com",
    "www.csaainsurance.aaa.com"
  ],
  "allstate": [
    "www.allstate.com"
  ],
  "american-family": [
    "www.amfam.com"
  ],
  "amica": [
    "www.amica.com"
  ],
  "auto-owners": [
    "www.auto-owners.com"
  ],
  "country-financial": [
    "www.countryfinancial.com"
  ],
  "erie": [
    "www.erieinsurance.com"
  ],
  "farmers": [
    "www.farmers.com"
  ],
  "geico": [
    "www.geico.com"
  ],
  "hanover": [
    "www.hanover.com"
  ],
  "kemper": [
    "www.kemper.com"
  ],
  "liberty-mutual": [
    "www.libertymutual.com"
  ],
  "mapfre": [
    "www.mapfreinsurance.com"
  ],
  "mercury": [
    "www.mercuryinsurance.com"
  ],
  "nationwide": [
    "www.nationwide.com"
  ],
  "njm": [
    "www.njm.com"
  ],
  "progressive": [
    "www.progressive.com"
  ],
  "shelter": [
    "support.shelterinsurance.com",
    "www.shelterinsurance.com"
  ],
  "state-farm": [
    "www.statefarm.com"
  ],
  "the-hartford": [
    "www.thehartford.com"
  ],
  "travelers": [
    "www.travelers.com"
  ],
  "usaa": [
    "www.usaa.com"
  ]
};

describe("insurer guide content", () => {
  it("has exactly one lazy content module for each supported insurer", () => {
    expect(Object.keys(import.meta.glob("./guides/*.ts")).sort()).toEqual(
      insurers.map(insurer => `./guides/${insurer.slug}.ts`).sort(),
    );
  });

  it.each(insurers)("loads $name with complete, internally consistent citations", async insurer => {
    const guide = await loadInsurerGuide(insurer);
    expect(guide.slug).toBe(insurer.slug);
    expect(guide).not.toHaveProperty("description");
    expect(guide.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const checked = new Date(`${guide.checkedOn}T00:00:00Z`);
    expect(checked.toISOString().slice(0, 10)).toBe(guide.checkedOn);
    expect(checked.getTime()).toBeLessThanOrEqual(Date.now());
    expect(guide.documents.length).toBeGreaterThan(0);
    expect(guide.valuation.length).toBeGreaterThan(0);
    expect(guide.reconsideration.length).toBeGreaterThan(0);
    expect(guide.faqs.length).toBeGreaterThanOrEqual(2);
    expect(new Set(guide.faqs.map(faq => faq.title)).size).toBe(guide.faqs.length);
    expect(guide.sources.length).toBeGreaterThanOrEqual(2);
    const sourceIds = new Set(guide.sources.map(source => source.id));
    expect(sourceIds.size).toBe(guide.sources.length);
    const referenced = new Set<string>();
    for (const paragraph of paragraphs(guide)) {
      expect(paragraph.text.trim()).not.toBe("");
      expect(paragraph.text).not.toMatch(/<\/?(?:p|a|strong)\b|TODO|TBD/);
      for (const sourceId of paragraph.sources ?? []) {
        expect(sourceIds.has(sourceId), `${insurer.slug}: missing ${sourceId}`).toBe(true);
        referenced.add(sourceId);
      }
    }
    expect(guide.documents.filter(paragraph => paragraph.sources?.length).length)
      .toBeGreaterThanOrEqual(2);
    for (const source of guide.sources) {
      expect(referenced.has(source.id), `${insurer.slug}: unused ${source.id}`).toBe(true);
      expect(new URL(source.url).protocol).toBe("https:");
      expect(officialHosts[insurer.slug]).toContain(new URL(source.url).hostname);
      expect(source.title.trim()).not.toBe("");
      expect(source.locator.trim()).not.toBe("");
      expect(source.applicability.trim()).not.toBe("");
      expect(source.claims.length).toBeGreaterThan(0);
      expect(source.checkedOn).toBe(guide.checkedOn);
    }
  });

  it("keeps market evidence and report-provider descriptions qualified", async () => {
    const usaa = await guideText("usaa");
    expect(usaa).toContain("offered for sale");
    expect(usaa).toContain("not be described as verified sale prices");
    expect(usaa).toContain("without naming a company");
    const nationwide = await guideText("nationwide");
    expect(nationwide).toContain("does not identify Copart as the valuation-report vendor");
    const allstate = await guideText("allstate");
    expect(allstate).toContain("does not identify that service as the valuation-report provider");
  });

  it("preserves conditional policy processes and different claimant paths", async () => {
    const farmers = await guideText("farmers");
    expect(farmers).toContain("when the policy includes an appraisal clause");
    expect(farmers).toContain("claim against another driver");
    const liberty = await guideText("liberty-mutual");
    expect(liberty).toContain("separate third-party guidance");
    const progressive = await guideText("progressive");
    expect(progressive).toContain("policyholders with rental coverage");
    expect(progressive).toContain("separate guidance for non-policyholders");
    const geico = await guideText("geico");
    expect(geico).toContain("depends on your state");
  });

  it("keeps the three AAA organizations and their source scope distinct", async () => {
    const enterprise = await guideText("aaa-auto-club-enterprises");
    expect(enterprise).toContain("VIN or stock number");
    const csaa = await guideText("aaa-csaa");
    expect(csaa).toContain("comprehensive auto losses");
    expect(csaa).toContain("policy or claim letter");
    const group = await guideText("aaa-auto-club-group");
    expect(group).toContain("underwriting companies");
    expect(group).toContain("non-original equipment");
    expect(findInsurer("aaa")).toBeUndefined();
  });

  it("qualifies replacement coverage and preserves the new non-customer pathways", async () => {
    expect(await guideText("hanover")).toContain("does not establish that your policy includes it");
    expect(await guideText("shelter")).toContain("non-customer phone pathway");
    expect(await guideText("amica")).toContain("non-customer upload");
    expect(await guideText("auto-owners")).toContain("separate entry points");
    expect(await guideText("the-hartford")).toContain("separate reporting route");
    expect(await guideText("country-financial")).toContain("Do not assume so");
  });

});
