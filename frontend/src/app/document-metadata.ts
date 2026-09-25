import { useEffect } from "react";

export interface PageMetadata {
  title: string;
  description: string;
  canonical?: string;
}

export function isPageMetadata(value: unknown): value is PageMetadata {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.title === "string" &&
    typeof candidate.description === "string"
  );
}

export function useDocumentMetadata(metadata: PageMetadata | null) {
  const title = metadata?.title;
  const description = metadata?.description;
  const canonical = metadata?.canonical;

  useEffect(() => {
    if (!title || !description) {
      return;
    }

    document.title = title;

    const descriptionElement = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]',
    );
    descriptionElement?.setAttribute("content", description);

    document.head.querySelectorAll("[data-state-metadata]").forEach(element => element.remove());
    if (!canonical) return;
    const link = document.createElement("link");
    link.rel = "canonical";
    link.href = canonical;
    link.dataset.stateMetadata = "";
    document.head.append(link);
    for (const [property, content] of [["og:title", title], ["og:description", description], ["og:url", canonical], ["og:type", "website"]]) {
      const element = document.createElement("meta");
      element.setAttribute("property", property);
      element.content = content;
      element.dataset.stateMetadata = "";
      document.head.append(element);
    }
    return () => document.head.querySelectorAll("[data-state-metadata]").forEach(element => element.remove());
  }, [canonical, description, title]);
}
