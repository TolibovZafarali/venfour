import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigEnv } from "vite";

import { createViteConfiguration } from "./vite.config";

const BUILD_ENVIRONMENT: ConfigEnv = {
  command: "build",
  mode: "production",
  isSsrBuild: false,
  isPreview: false,
};

async function withLocalTurnstileKey(
  siteKey: string,
  callback: (environmentDirectory: string) => void | Promise<void>,
) {
  const environmentDirectory = await mkdtemp(
    path.join(tmpdir(), "venfour-vite-environment-"),
  );
  const hadProcessValue = Object.hasOwn(
    process.env,
    "VITE_TURNSTILE_SITE_KEY",
  );
  const processValue = process.env.VITE_TURNSTILE_SITE_KEY;
  delete process.env.VITE_TURNSTILE_SITE_KEY;

  try {
    await writeFile(
      path.join(environmentDirectory, ".env.local"),
      `VITE_TURNSTILE_SITE_KEY=${siteKey}\n`,
      "utf8",
    );
    await callback(environmentDirectory);
  } finally {
    if (hadProcessValue) {
      process.env.VITE_TURNSTILE_SITE_KEY = processValue;
    } else {
      delete process.env.VITE_TURNSTILE_SITE_KEY;
    }
    await rm(environmentDirectory, { recursive: true, force: true });
  }
}

describe("createViteConfiguration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("limits Stripe CSP origins and nonce support to the local purchase server", async () => {
    vi.stubEnv("VITE_ENABLE_POST_CONTINUE_FLOW", "true");
    await withLocalTurnstileKey("", (environmentDirectory) => {
      const config = createViteConfiguration({
        ...BUILD_ENVIRONMENT, command: "serve", mode: "development",
      }, environmentDirectory);
      const policy = config.server?.headers?.["Content-Security-Policy"];
      expect(policy).toContain("https://js.stripe.com https://*.js.stripe.com");
      expect(policy).toContain("https://hooks.stripe.com");
      expect(policy).toContain("https://api.stripe.com");
      expect(policy).toContain("https://vpic.nhtsa.dot.gov");
      expect(policy).not.toContain("https://*.dot.gov");
      expect(policy).not.toContain("https://*.stripe.com");
      expect(policy).not.toContain("unsafe-eval");
      expect(policy).toContain(`'nonce-${config.html?.cspNonce}'`);
      const build = createViteConfiguration(BUILD_ENVIRONMENT, environmentDirectory);
      expect(build.server?.headers).toBeUndefined();
      expect(build.html).toBeUndefined();
      vi.stubEnv("VITE_ENABLE_POST_CONTINUE_FLOW", "false");
      const normal = createViteConfiguration({
        ...BUILD_ENVIRONMENT, command: "serve", mode: "development",
      }, environmentDirectory);
      expect(normal.server?.headers).toBeUndefined();
    });
  });

  it("allows an empty Turnstile key in a production build", async () => {
    await withLocalTurnstileKey("", (environmentDirectory) => {
      expect(() =>
        createViteConfiguration(BUILD_ENVIRONMENT, environmentDirectory)
      ).not.toThrow();
    });
  });

  it("rejects an official Turnstile test key loaded from .env.local", async () => {
    await withLocalTurnstileKey(
      "1x00000000000000000000BB",
      (environmentDirectory) => {
        expect(() =>
          createViteConfiguration(BUILD_ENVIRONMENT, environmentDirectory)
        ).toThrow(
          "VITE_TURNSTILE_SITE_KEY must not use an official Turnstile test key in a production build.",
        );
      },
    );
  });

  it("rejects a secret-shaped value loaded from .env.local", async () => {
    await withLocalTurnstileKey(
      "0x4AAAAAAA000000000000000000000000000AA",
      (environmentDirectory) => {
        expect(() =>
          createViteConfiguration(BUILD_ENVIRONMENT, environmentDirectory)
        ).toThrow(
          "VITE_TURNSTILE_SITE_KEY must not contain a secret or any value longer than 32 characters in a production build.",
        );
      },
    );
  });
});
