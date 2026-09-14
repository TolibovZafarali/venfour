import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { validatePublicSiteEnvironment } from "./public-site-environment.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
validatePublicSiteEnvironment(loadEnv("public-site", root, "VITE_"));
console.log("Public website environment is valid; application configuration is absent.");
