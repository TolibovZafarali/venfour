import { NavLink, Outlet } from "react-router";

import { cn } from "@/lib/utils";

const navigation = [
  { to: "/", label: "Home", end: true },
  { to: "/workspace", label: "Workspace", end: false },
] as const;

export function AppShell() {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="border-b bg-background/95">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <NavLink
            to="/"
            className="text-lg font-semibold tracking-tight"
            aria-label="Venfour home"
          >
            Venfour
          </NavLink>
          <nav aria-label="Primary navigation" className="flex gap-1">
            {navigation.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                    isActive && "bg-muted text-foreground",
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="flex flex-1">
        <Outlet />
      </main>
      <footer className="border-t">
        <div className="mx-auto w-full max-w-6xl px-6 py-5 text-sm text-muted-foreground">
          Independent vehicle-valuation guidance for total-loss claims.
        </div>
      </footer>
    </div>
  );
}
