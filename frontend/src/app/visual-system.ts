import { hostAudience, routeAudience } from "@/app/site-boundary";
import { publicSiteOnly } from "@/config/public-site";

export type VisualSystem = "public" | "app";

// Production hosts own their presentation. Local and staging builds support both.
export function visualSystemForLocation(pathname: string, origin?: string): VisualSystem {
  const audience = hostAudience(origin);
  if (audience === "application") return "app";
  if (audience === "public" || publicSiteOnly) return "public";
  return routeAudience(pathname) === "public" ? "public" : "app";
}

export function applyVisualSystem(pathname: string) {
  document.documentElement.dataset.visualSystem = visualSystemForLocation(pathname);
}
