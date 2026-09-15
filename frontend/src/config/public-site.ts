export const publicSiteOnly = import.meta.env.VITE_PUBLIC_SITE_ONLY === "true";
export const publicIntakeClosed = publicSiteOnly && import.meta.env.VITE_PUBLIC_INTAKE_OPEN !== "true";
