import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: import.meta.dirname,
  envDir: false,
  plugins: [react(), tailwindcss()],
  resolve: { alias: [
    { find: "@/app/site-boundary", replacement: path.resolve(import.meta.dirname, "site-boundary.ts") },
    { find: "@stripe/stripe-js/pure", replacement: path.resolve(import.meta.dirname, "payment-preview.ts") },
    { find: "@stripe/react-stripe-js/checkout", replacement: path.resolve(import.meta.dirname, "payment-preview.ts") },
    { find: "@", replacement: path.resolve(import.meta.dirname, "../../src") },
  ] },
  define: {
    "import.meta.env.VITE_ENABLE_POST_CONTINUE_FLOW": '"true"',
    "import.meta.env.VITE_API_BASE_URL": '""',
    "import.meta.env.VITE_SUPABASE_URL": '""',
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": '""',
  },
  server: {
    host: "127.0.0.1", port: 4186, strictPort: true,
    fs: { allow: [path.resolve(import.meta.dirname, "../../..")] },
    headers: { "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws://127.0.0.1:4186; frame-src 'none'; object-src 'none'" },
  },
});
