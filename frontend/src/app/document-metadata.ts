import { useEffect } from "react";

export interface PageMetadata {
  title: string;
  description: string;
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

  useEffect(() => {
    if (!title || !description) {
      return;
    }

    document.title = title;

    const descriptionElement = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]',
    );
    descriptionElement?.setAttribute("content", description);
  }, [description, title]);
}
