import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import "./app-entry-loading.css";

const EntryStartedAt = createContext<number | null>(null);
const indicatorDelay = 300;

// Keep one delay while authentication, account role, and saved cases resolve.
export function AppEntryLoadingScope({ children }: { children: ReactNode }) {
  const [startedAt] = useState(() => Date.now());
  return <EntryStartedAt.Provider value={startedAt}>{children}</EntryStartedAt.Provider>;
}

export function AppEntryLoading({ compact = false }: { compact?: boolean }) {
  const entryStartedAt = useContext(EntryStartedAt);
  const [startedAt] = useState(() => entryStartedAt ?? Date.now());
  const [visible, setVisible] = useState(() => Date.now() - startedAt >= indicatorDelay);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), Math.max(0, indicatorDelay - (Date.now() - startedAt)));
    return () => window.clearTimeout(timer);
  }, [startedAt]);

  return <section className={`app-entry-loading${compact ? " app-entry-loading--compact" : ""}`} data-app-entry-loading>
    <div className="app-entry-loading__status" data-visible={visible || undefined} role="status" aria-hidden={!visible}>
      <span className="app-entry-loading__indicator" aria-hidden="true" />
      <p>Opening your workspace…</p>
    </div>
  </section>;
}
