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
    const owned: HTMLElement[] = [];
    if (canonical) {
      for (const [property, content] of [["og:title", title], ["og:description", description], ["og:url", canonical], ["og:type", "website"]]) {
        const node = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`) ?? document.createElement("meta");
        node.setAttribute("property", property); node.setAttribute("content", content); document.head.append(node); owned.push(node);
      }
      const link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]') ?? document.createElement("link");
      link.rel = "canonical"; link.href = canonical; document.head.append(link); owned.push(link);
    }
    return () => owned.forEach(node => node.remove());
  }, [canonical, description, title]);
}
