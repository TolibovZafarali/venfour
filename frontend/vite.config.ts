import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import {
  type ConfigEnv,
  defineConfig,
  loadEnv,
  type UserConfig,
} from "vite";

import { assertProductionTurnstileSiteKey } from "./scripts/turnstile-site-key.mjs";

export function createViteConfiguration(
  { command, mode }: ConfigEnv,
  environmentDirectory = import.meta.dirname,
): UserConfig {
  const environment = loadEnv(mode, environmentDirectory, "VENFOUR_");
  const publicEnvironment = loadEnv(mode, environmentDirectory, "VITE_");
  if (command === "build") {
    assertProductionTurnstileSiteKey(
      publicEnvironment.VITE_TURNSTILE_SITE_KEY,
    );
  }

  const apiProxyTarget =
    environment.VENFOUR_API_PROXY_TARGET || "http://127.0.0.1:8000";

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
    server: {
      proxy: {
        "/api": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        "/health": {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
  };
}

export default defineConfig((configEnvironment) =>
  createViteConfiguration(configEnvironment)
);
