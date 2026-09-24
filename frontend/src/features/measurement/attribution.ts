import { hasAdvertisingConsent, sharedCookieDomain } from "@/features/privacy/consent";

export const attributionKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "gbraid", "wbraid"] as const;
export type AttributionKey = typeof attributionKeys[number];
export type Attribution = Partial<Record<AttributionKey, string>> & {
  landing_page: "/" | "/start";
  captured_at: string;
};
const KEY = "venfour.acquisition";
const MAX_AGE = 30 * 24 * 60 * 60;
let pending: Attribution | null = null;

export function parseAttribution(search: string, pathname: string, now = new Date()): Attribution | null {
  const query = new URLSearchParams(search);
  const result: Attribution = {
    landing_page: pathname === "/start" ? pathname : "/",
    captured_at: now.toISOString(),
  };
  for (const key of attributionKeys) {
    const values = query.getAll(key);
    const value = values.length === 1 ? values[0].trim() : "";
    const click = ["gclid", "gbraid", "wbraid"].includes(key);
    if (value && value.length <= (click ? 256 : 120)
      && (click ? /^[A-Za-z0-9_-]+$/ : /^[A-Za-z0-9 _.,+~-]+$/).test(value)) result[key] = value;
  }
  return attributionKeys.some(key => result[key]) ? result : null;
}

function paid(value: Attribution) {
  return Boolean(value.gclid || value.gbraid || value.wbraid || /^(cpc|ppc|paidsearch)$/i.test(value.utm_medium ?? ""));
}

export function readAttribution(now = Date.now()): Attribution | null {
  if (!hasAdvertisingConsent()) return null;
  try {
    const raw = document.cookie.split("; ").find(row => row.startsWith(`${KEY}=`))?.slice(KEY.length + 1);
    if (!raw) return null;
    const value = JSON.parse(decodeURIComponent(raw));
    // Read older attribution cookies without discarding their first paid touch.
    // parseAttribution normalizes the retired page value to the public homepage.
    if (!value || typeof value !== "object" || !["/", "/total-loss-review", "/start"].includes(value.landing_page)
      || typeof value.captured_at !== "string") return null;
    const age = now - Date.parse(value.captured_at);
    if (!Number.isFinite(age) || age < 0 || age > MAX_AGE * 1000) return null;
    const query = new URLSearchParams();
    for (const key of attributionKeys) if (typeof value[key] === "string") query.set(key, value[key]);
    return parseAttribution(query.toString(), value.landing_page, new Date(value.captured_at));
  } catch { return null; }
}

export function captureAttribution(search = window.location.search, pathname = window.location.pathname) {
  const entry = parseAttribution(search, pathname);
  if (entry && (!pending || (!paid(pending) && paid(entry)))) pending = entry;
  if (!hasAdvertisingConsent()) return;
  const saved = readAttribution();
  const next = saved && (paid(saved) || !pending || !paid(pending)) ? saved : pending ?? saved;
  if (next) {
    try { document.cookie = `${KEY}=${encodeURIComponent(JSON.stringify(next))}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${sharedCookieDomain()}`; } catch { /* Optional storage never blocks intake. */ }
  }
}

export function clearAttribution() {
  pending = null;
  try { document.cookie = `${KEY}=; Path=/; Max-Age=0; SameSite=Lax${sharedCookieDomain()}`; } catch { /* Storage may be unavailable. */ }
}
