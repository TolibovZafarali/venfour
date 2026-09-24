import { isEmail } from "./staging-environment.mjs";

export function validatePublicSiteEnvironment(environment) {
  if (environment.VITE_PUBLIC_SITE_ONLY !== "true" || environment.VITE_PUBLIC_ORIGIN !== "https://venfour.com") {
    throw new Error("The public website build must explicitly select the public-only production origin.");
  }
  if (!isEmail(environment.VITE_SUPPORT_EMAIL)) throw new Error("The public website requires its published support address.");
  if (environment.VITE_PUBLIC_INTAKE_OPEN && !["true", "false"].includes(environment.VITE_PUBLIC_INTAKE_OPEN)) {
    throw new Error("Public intake availability must be explicitly true or false.");
  }
  const allowed = new Set(["VITE_PUBLIC_SITE_ONLY", "VITE_PUBLIC_ORIGIN", "VITE_SUPPORT_EMAIL", "VITE_PUBLIC_INTAKE_OPEN", "VITE_GOOGLE_ADS_CONVERSION_ID", "VITE_GOOGLE_ADS_PURCHASE_LABEL", "VITE_GOOGLE_ENHANCED_CONVERSIONS"]);
  if (Object.entries(environment).some(([name, value]) => name.startsWith("VITE_") && value && !allowed.has(name))) {
    throw new Error("Application and provider configuration must be absent from the public website build.");
  }
}
