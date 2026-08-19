import { describe, expect, it } from "vitest";

import { isAcceptedFile, mergeUniqueFiles } from "./local-document-files";

describe("local diminished-value documents", () => {
  it("accepts the documented browser-local formats", () => {
    expect(isAcceptedFile(file("estimate.pdf", "application/pdf"))).toBe(true);
    expect(isAcceptedFile(file("damage.jpeg", "image/jpeg"))).toBe(true);
    expect(isAcceptedFile(file("damage.PNG", ""))).toBe(true);
    expect(isAcceptedFile(file("phone-photo.heic", "image/heic"))).toBe(true);
    expect(isAcceptedFile(file("notes.txt", "text/plain"))).toBe(false);
  });

  it("merges repeated selections and removes duplicate file identities", () => {
    const estimate = file("estimate.pdf", "application/pdf", 1_000, 10);
    const photo = file("damage.jpg", "image/jpeg", 2_000, 20);
    const duplicateEstimate = file(
      "estimate.pdf",
      "application/pdf",
      1_000,
      10,
    );

    expect(mergeUniqueFiles([estimate], [duplicateEstimate, photo])).toEqual([
      estimate,
      photo,
    ]);
  });
});

function file(
  name: string,
  type: string,
  size = 10,
  lastModified = 1,
) {
  return new File(["x".repeat(size)], name, { type, lastModified });
}
