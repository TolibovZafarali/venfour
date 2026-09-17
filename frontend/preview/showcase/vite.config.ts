import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  plugins: [react(), tailwindcss(), {
    name: "local-showcase-boundary",
    configResolved(config) {
      if (config.command !== "serve" || config.server.host !== "127.0.0.1") throw new Error("The showcase only runs on loopback; building and remote hosting are disabled.");
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!/^(127\.0\.0\.1|localhost):4187$/u.test(request.headers.host ?? "")) {
          response.statusCode = 403;
          response.end("Local showcase only.");
          return;
        }
        if (request.url?.startsWith("/api/")) {
          response.statusCode = 403;
          response.end("The showcase has no backend connection.");
          return;
        }
        next();
      });
    },
  }],
  resolve: { alias: [
    { find: "@/features/total-loss-claim/browser-actions", replacement: path.resolve(import.meta.dirname, "./browser-actions.ts") },
    { find: "@/app/site-boundary", replacement: path.resolve(import.meta.dirname, "../workspace/site-boundary.ts") },
    { find: "@stripe/stripe-js/pure", replacement: path.resolve(import.meta.dirname, "./payment.tsx") },
    { find: "@stripe/react-stripe-js/checkout", replacement: path.resolve(import.meta.dirname, "./payment.tsx") },
    { find: "@", replacement: path.resolve(import.meta.dirname, "../../src") },
  ] },
  define: {
    "import.meta.env.VITE_WORKSPACE_STRIPE_SANDBOX": "false",
    "import.meta.env.VITE_PUBLIC_SITE_ONLY": "false",
    "import.meta.env.VITE_ENABLE_POST_CONTINUE_FLOW": '"true"',
    "import.meta.env.VITE_API_BASE_URL": '""',
    "import.meta.env.VITE_SUPABASE_URL": '""',
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": '""',
    "import.meta.env.VITE_TURNSTILE_SITE_KEY": '""',
  },
  server: {
    host: "127.0.0.1", port: 4187, strictPort: true,
    fs: { allow: [path.resolve(import.meta.dirname, "../..")], deny: ["**/.env*", "**/*.pem", "**/*.key", "**/data/**", "**/.git/**", "**/output/**", "**/node_modules/**/.env*"] },
    headers: { "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws://127.0.0.1:4187; frame-src 'self'; object-src 'none'; form-action 'none'", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" },
  },
});
