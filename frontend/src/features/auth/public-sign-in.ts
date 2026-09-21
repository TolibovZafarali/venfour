import { APPLICATION_ORIGIN } from "@/app/site-boundary";

export const PUBLIC_SIGN_IN_PATH = "/auth/sign-in";
export const PUBLIC_SIGN_IN_MESSAGE = "venfour:public-sign-in";
export const PUBLIC_SIGN_IN_PARENTS = ["https://venfour.com", "https://www.venfour.com"];

export function publicSignInAction(event: MessageEvent, frame: Window | null) {
  if (!frame || event.source !== frame || event.origin !== APPLICATION_ORIGIN) return null;
  const data: unknown = event.data;
  if (!data || typeof data !== "object" || !("type" in data) || data.type !== PUBLIC_SIGN_IN_MESSAGE || !("action" in data)) return null;
  const action = data.action;
  return action === "ready" || action === "close" || action === "complete" || action === "google" || action === "apple" ? action : null;
}
