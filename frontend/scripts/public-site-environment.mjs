import { isEmail } from "./staging-environment.mjs";

export function validatePublicSiteEnvironment(environment) {
  if (environment.VITE_PUBLIC_SITE_ONLY !== "true" || environment.VITE_PUBLIC_ORIGIN !== "https://venfour.com") {
    throw new Error("The public website build must explicitly select the public-only production origin.");
  }
  if (!isEmail(environment.VITE_SUPPORT_EMAIL)) throw new Error("The public website requires its published support address.");
  const allowed = new Set(["VITE_PUBLIC_SITE_ONLY", "VITE_PUBLIC_ORIGIN", "VITE_SUPPORT_EMAIL"]);
  if (Object.entries(environment).some(([name, value]) => name.startsWith("VITE_") && value && !allowed.has(name))) {
    throw new Error("Application and provider configuration must be absent from the public website build.");
  }
}
