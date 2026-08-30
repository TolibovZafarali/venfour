import { describe, expect, it, vi } from "vitest";

import {
  createGuardedSessionStorage,
  SessionInstallationIdentityError,
} from "@/lib/supabase/guarded-session-storage";

const KEY = "test-auth-session";
const guest = JSON.stringify({ access_token: "guest-session", user: { id: "guest", is_anonymous: true } });
const verified = JSON.stringify({ access_token: "verified-session", user: { id: "owner", is_anonymous: false } });
const unrelated = JSON.stringify({ access_token: "unrelated-session", user: { id: "other-owner", is_anonymous: false } });

function setup() {
  const values = new Map([[KEY, guest]]);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: (key: string) => { values.delete(key); },
  };
  const guarded = createGuardedSessionStorage(storage);
  const assertUnchanged = vi.fn();
  const guard = { accessToken: "verified-session", expectedAnonymousUserId: "guest", assertUnchanged };
  return { storage, guarded, guard, assertUnchanged };
}

describe("guarded local session installation", () => {
  it("publishes only while the persisted owner remains the original anonymous identity", async () => {
    const h = setup();
    await h.guarded.install(h.guard, async () => h.guarded.storage.setItem(KEY, verified));
    expect(h.storage.getItem(KEY)).toBe(verified);
    expect(h.assertUnchanged).toHaveBeenCalledTimes(2);
  });

  it("stops a session write if identity changes during the asynchronous Auth user lookup", async () => {
    const h = setup();
    await expect(h.guarded.install(h.guard, async () => {
      await Promise.resolve();
      await h.guarded.storage.setItem(KEY, unrelated);
      await h.guarded.storage.setItem(KEY, verified);
    })).rejects.toBeInstanceOf(SessionInstallationIdentityError);
    expect(h.storage.getItem(KEY)).toBe(unrelated);
    expect(h.storage.setItem).toHaveBeenCalledExactlyOnceWith(KEY, unrelated);
  });

  it.each([null, "malformed-session", JSON.stringify({ user: { id: "guest", is_anonymous: false } })])(
    "rejects missing, malformed, or no-longer-anonymous persisted state", async (state) => {
      const h = setup();
      if (state === null) h.storage.removeItem(KEY);
      else h.storage.setItem(KEY, state);
      await expect(h.guarded.install(h.guard, async () => h.guarded.storage.setItem(KEY, verified)))
        .rejects.toBeInstanceOf(SessionInstallationIdentityError);
      expect(h.storage.getItem(KEY)).toBe(state);
    },
  );

  it("does not block normal sign-in, refresh, cleanup, or unrelated storage writes", async () => {
    const h = setup();
    await h.guarded.install(h.guard, async () => {
      await h.guarded.storage.setItem(KEY, unrelated);
      await h.guarded.storage.setItem("flow-state", "value");
      await h.guarded.storage.removeItem("flow-state");
    });
    expect(h.storage.getItem(KEY)).toBe(unrelated);
    expect(h.storage.getItem("flow-state")).toBeNull();
  });

  it("checks abort/version state immediately at the actual session write", async () => {
    const h = setup();
    await expect(h.guarded.install(h.guard, async () => {
      h.assertUnchanged.mockImplementationOnce(() => { throw new Error("Operation cancelled"); });
      await h.guarded.storage.setItem(KEY, verified);
    })).rejects.toThrow("Operation cancelled");
    expect(h.storage.getItem(KEY)).toBe(guest);
  });

  it("releases the operation guard after failure", async () => {
    const h = setup();
    await expect(h.guarded.install(h.guard, async () => { throw new Error("Offline"); })).rejects.toThrow("Offline");
    await h.guarded.install(h.guard, async () => h.guarded.storage.setItem(KEY, verified));
    expect(h.storage.getItem(KEY)).toBe(verified);
  });

  it("checks persisted identity after acquiring the shared mutation lock", async () => {
    const h = setup();
    const lock = vi.fn(async (_key: string, action: () => void) => {
      await Promise.resolve();
      h.storage.setItem(KEY, unrelated);
      return action();
    });
    const guarded = createGuardedSessionStorage(h.storage, lock);
    await expect(guarded.install(h.guard, async () => guarded.storage.setItem(KEY, verified)))
      .rejects.toBeInstanceOf(SessionInstallationIdentityError);
    expect(lock).toHaveBeenCalledExactlyOnceWith(KEY, expect.any(Function));
    expect(h.storage.getItem(KEY)).toBe(unrelated);
  });

  it("takes the same per-key mutation lock for normal session updates and removals", async () => {
    const h = setup();
    const lock = vi.fn(async (_key: string, action: () => void) => action());
    const guarded = createGuardedSessionStorage(h.storage, lock);
    await guarded.storage.setItem(KEY, unrelated);
    await guarded.storage.removeItem(KEY);
    expect(lock).toHaveBeenNthCalledWith(1, KEY, expect.any(Function));
    expect(lock).toHaveBeenNthCalledWith(2, KEY, expect.any(Function));
    expect(h.storage.getItem(KEY)).toBeNull();
  });
});
