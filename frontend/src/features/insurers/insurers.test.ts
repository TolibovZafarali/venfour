import { describe, expect, it } from "vitest";
import {
  findInsurer,
  insurerDirectoryMetadata,
  insurerFromPath,
  insurerMetadata,
  insurerPath,
  insurers,
} from "./insurers";

describe("insurer catalog", () => {
  it("contains the eight launch guides in alphabetical order", () => {
    expect(insurers.map(insurer => insurer.slug)).toEqual([
      "allstate", "farmers", "geico", "liberty-mutual",
      "nationwide", "progressive", "state-farm", "usaa",
    ]);
    expect(new Set(insurers.map(insurer => insurer.slug)).size).toBe(insurers.length);
    expect(new Set(insurers.map(insurer => insurer.summary)).size).toBe(insurers.length);
    expect(new Set(insurers.map(insurer => insurer.description)).size).toBe(insurers.length);
  });

  it.each(insurers)("resolves $name with one canonical and catalog-owned metadata", insurer => {
    expect(findInsurer(insurer.slug)).toBe(insurer);
    expect(insurerFromPath(insurerPath(insurer))).toBe(insurer);
    expect(insurerFromPath(`${insurerPath(insurer)}/`)).toBe(insurer);
    expect(insurerMetadata(insurer)).toEqual({
      title: `${insurer.name} Total-Loss Guide & Valuation Review | Venfour`,
      description: insurer.description,
      canonical: `https://venfour.com/insurers/${insurer.slug}`,
    });
    expect(insurer.summary.trim()).not.toBe("");
    expect(insurer.description).toContain(insurer.name);
  });

  it.each([
    "/insurers", "/insurers/", "/insurers/unknown", "/insurers/GEICO",
    "/insurers/geico/extra", "/insurers/geico//", "/insurers/geico?claim=1",
    "/insurers/%67eico", "/insurers/geico-california", "/insurers/geico/california",
  ])("does not resolve an unsupported insurer path: %s", path => {
    expect(insurerFromPath(path)).toBeUndefined();
  });

  it("keeps the directory separate from individual guides", () => {
    expect(findInsurer(undefined)).toBeUndefined();
    expect(insurerDirectoryMetadata.canonical).toBe("https://venfour.com/insurers");
    expect(insurerDirectoryMetadata.title).toContain("Insurance Company");
    expect(insurerDirectoryMetadata.description.trim()).not.toBe("");
  });
});
