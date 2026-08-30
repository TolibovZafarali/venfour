interface SessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface InstallationGuard {
  accessToken: string;
  expectedAnonymousUserId: string;
  assertUnchanged(): void;
}

type SessionMutationLock = (key: string, action: () => void) => Promise<void>;

export class SessionInstallationIdentityError extends Error {
  constructor() {
    super("The active identity changed before session installation.");
    this.name = "SessionInstallationIdentityError";
  }
}

export function createGuardedSessionStorage(
  storage: SessionStorage,
  lockMutation: SessionMutationLock = async (_key, action) => action(),
) {
  let guard: InstallationGuard | null = null;

  return {
    storage: {
      getItem: (key: string) => storage.getItem(key),
      removeItem: (key: string) => lockMutation(key, () => storage.removeItem(key)),
      setItem(key: string, value: string) {
        return lockMutation(key, () => {
          const candidate = parseSession(value);
          if (guard && candidate?.access_token === guard.accessToken) {
            guard.assertUnchanged();
            const current = parseSession(storage.getItem(key));
            if (current?.user?.id !== guard.expectedAnonymousUserId ||
              current.user.is_anonymous !== true) {
              throw new SessionInstallationIdentityError();
            }
          }
          storage.setItem(key, value);
        });
      },
    },
    async install<T>(installationGuard: InstallationGuard, action: () => Promise<T>) {
      if (guard) throw new SessionInstallationIdentityError();
      guard = installationGuard;
      try {
        guard.assertUnchanged();
        return await action();
      } finally {
        guard = null;
      }
    },
  };
}

export function hasBrowserSessionLocks() {
  return typeof navigator !== "undefined" && typeof navigator.locks?.request === "function";
}

export const lockBrowserSessionMutation: SessionMutationLock = (key, action) =>
  navigator.locks.request(`venfour.session-write:${key}`, { mode: "exclusive" }, action);

function parseSession(value: string | null): {
  access_token?: unknown;
  user?: { id?: unknown; is_anonymous?: unknown };
} | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export function createBrowserSessionStorage(): SessionStorage {
  try {
    const storage = window.localStorage;
    const probe = "venfour.session-storage-check";
    storage.setItem(probe, "available");
    storage.removeItem(probe);
    return storage;
  } catch {
    const values = new Map<string, string>();
    return {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: (key) => { values.delete(key); },
    };
  }
}
