import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
describe("local continuation flag", () => {
  it("keeps fixture creation separate from full-flow continuation", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_ENABLE_POST_CONTINUE_FLOW", "true");
    vi.stubEnv("VITE_ENABLE_LOCAL_CLAIM_FIXTURES", "false");
    let config = (await import("./env")).environment;
    expect(config.localPostContinueEnabled).toBe(true);
    expect(config.localClaimFixturesEnabled).toBe(false);
    vi.resetModules();
    vi.stubEnv("VITE_ENABLE_LOCAL_CLAIM_FIXTURES", "true");
    config = (await import("./env")).environment;
    expect(config.localClaimFixturesEnabled).toBe(true);
    vi.resetModules();
    vi.stubEnv("DEV", false);
    config = (await import("./env")).environment;
    expect(config.localPostContinueEnabled).toBe(false);
    expect(config.localClaimFixturesEnabled).toBe(false);
  });
  it.each(["staging.venfour.com", "venfour.com", "preview.example.test", "localhost.example.test"])(
    "cannot activate on %s even with an explicit development flag", async (hostname) => {
      vi.stubEnv("DEV", true);
      vi.stubEnv("VITE_ENABLE_POST_CONTINUE_FLOW", "true");
      vi.stubGlobal("window", { location: { hostname } });
      expect((await import("./env")).environment.localPostContinueEnabled).toBe(false);
    },
  );
  it.each([
    [true, undefined, false],
    [true, "false", false],
    [true, "true", true],
    [false, "true", false],
  ])("requires dev mode %s and explicit flag %s", async (dev, flag, enabled) => {
    vi.stubEnv("DEV", dev);
    vi.stubEnv("VITE_ENABLE_POST_CONTINUE_FLOW", flag);
    expect((await import("./env")).environment.localPostContinueEnabled).toBe(enabled);
  });
});
