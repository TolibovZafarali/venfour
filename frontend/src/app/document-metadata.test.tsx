import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insurerDirectoryMetadata, insurerMetadata, insurers } from "@/features/insurers/insurers";
import { stateMetadata, states } from "@/features/states/states";
import { type PageMetadata, useDocumentMetadata } from "./document-metadata";

let description: HTMLMetaElement;
beforeEach(() => {
  description = document.createElement("meta");
  description.name = "description";
  document.head.append(description);
});
afterEach(() => {
  description.remove();
  document.head.querySelectorAll("[data-page-metadata]").forEach(element => element.remove());
});

function expectMetadata(metadata: PageMetadata) {
  expect(document.title).toBe(metadata.title);
  expect(description.content).toBe(metadata.description);
  expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
  expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute("href", metadata.canonical);
  expect(document.head.querySelectorAll('meta[property^="og:"]')).toHaveLength(4);
  expect(document.head.querySelector('meta[property="og:title"]')).toHaveAttribute("content", metadata.title);
  expect(document.head.querySelector('meta[property="og:description"]')).toHaveAttribute("content", metadata.description);
  expect(document.head.querySelector('meta[property="og:url"]')).toHaveAttribute("content", metadata.canonical);
}

describe("page metadata", () => {
  it("replaces edge tags through insurer, directory and state navigation, then clears them when leaving", () => {
    const initial = insurerMetadata(insurers[0]);
    const edgeCanonical = document.createElement("link");
    edgeCanonical.rel = "canonical";
    edgeCanonical.href = initial.canonical;
    edgeCanonical.dataset.pageMetadata = "";
    document.head.append(edgeCanonical);
    const edgeOpenGraph = document.createElement("meta");
    edgeOpenGraph.setAttribute("property", "og:url");
    edgeOpenGraph.content = initial.canonical;
    edgeOpenGraph.dataset.pageMetadata = "";
    document.head.append(edgeOpenGraph);

    const initialProps: { metadata: PageMetadata } = { metadata: initial };
    const { rerender, unmount } = renderHook(({ metadata }: { metadata: PageMetadata }) => useDocumentMetadata(metadata), { initialProps });
    expectMetadata(initial);
    for (const metadata of [insurerMetadata(insurers[1]), insurerDirectoryMetadata, stateMetadata(states[0])]) {
      rerender({ metadata });
      expectMetadata(metadata);
    }
    rerender({ metadata: { title: "Methodology | Venfour", description: "How the review works." } });
    expect(document.title).toBe("Methodology | Venfour");
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull();
    expect(document.head.querySelector('meta[property^="og:"]')).toBeNull();
    unmount();
  });
});
