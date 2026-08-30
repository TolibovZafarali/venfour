import path from "node:path";
import { randomBytes } from "node:crypto";

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
  const localPurchase = command === "serve" && mode === "development" &&
    publicEnvironment.VITE_ENABLE_POST_CONTINUE_FLOW === "true";
  const nonce = localPurchase ? randomBytes(24).toString("base64") : undefined;
  const localPurchasePolicy = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' https://challenges.cloudflare.com https://js.stripe.com https://*.js.stripe.com`,
    "frame-src 'self' https://challenges.cloudflare.com https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com",
    "connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321 ws://localhost:5173 ws://127.0.0.1:5173 https://challenges.cloudflare.com https://api.stripe.com https://vpic.nhtsa.dot.gov",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
  ].join("; ");

  return {
    plugins: [react(), tailwindcss()],
    ...(nonce ? { html: { cspNonce: nonce } } : {}),
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
    server: {
      ...(localPurchase ? {
        headers: {
          "Content-Security-Policy": localPurchasePolicy,
          "Referrer-Policy": "no-referrer",
          "Cache-Control": "no-store",
        },
      } : {}),
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
