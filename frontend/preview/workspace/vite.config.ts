import path from "node:path";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sandboxCheckout } from "./stripe-sandbox.ts";

const sessionFile = process.env.VENFOUR_WORKSPACE_STRIPE_SESSION_FILE;
const checkout = sessionFile ? sandboxCheckout(JSON.parse(readFileSync(sessionFile, "utf8"))) : null;

export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  plugins: [react(), tailwindcss(), {
    name: "workspace-stripe-sandbox",
    configureServer(server) {
      server.middlewares.use("/_local/stripe-checkout", (request, response) => {
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "application/json");
        response.statusCode = checkout && request.method === "GET" ? 200 : 404;
        response.end(JSON.stringify(response.statusCode === 200 ? checkout : { message: "Stripe sandbox preview is not enabled." }));
      });
    },
  }],
  resolve: { alias: [
    { find: "@/app/site-boundary", replacement: path.resolve(import.meta.dirname, "site-boundary.ts") },
    { find: "@/features/total-loss-claim/email-otp-service", replacement: path.resolve(import.meta.dirname, "verification-preview.ts") },
    ...(!checkout ? [
      { find: "@stripe/stripe-js/pure", replacement: path.resolve(import.meta.dirname, "payment-preview.ts") },
      { find: "@stripe/react-stripe-js/checkout", replacement: path.resolve(import.meta.dirname, "payment-preview.ts") },
    ] : []),
    { find: "@", replacement: path.resolve(import.meta.dirname, "../../src") },
  ] },
  define: {
    "import.meta.env.VITE_WORKSPACE_STRIPE_SANDBOX": JSON.stringify(Boolean(checkout)),
    "import.meta.env.VITE_ENABLE_POST_CONTINUE_FLOW": '"true"',
    "import.meta.env.VITE_API_BASE_URL": '""',
    "import.meta.env.VITE_SUPABASE_URL": '""',
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": '""',
  },
  server: {
    host: "127.0.0.1", port: 4186, strictPort: true,
    fs: { allow: [path.resolve(import.meta.dirname, "../../..")] },
    headers: { "Content-Security-Policy": checkout
      ? "default-src 'self'; script-src 'self' 'unsafe-inline' https://js.stripe.com https://*.js.stripe.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws://127.0.0.1:4186 https://api.stripe.com; frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com; object-src 'none'"
      : "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws://127.0.0.1:4186; frame-src 'none'; object-src 'none'" },
  },
});
