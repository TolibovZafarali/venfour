import { Link, Outlet, useMatch } from "react-router";

import { cn } from "@/lib/utils";

export function AppShell() {
  const analysisRoute = useMatch("/analyses/:runId");

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="border-b border-neutral-200 bg-white">
        <div
          className={cn(
            "mx-auto flex h-14 w-full items-center justify-between px-5 sm:px-8",
            analysisRoute ? "max-w-[90rem] lg:px-10" : "max-w-6xl",
          )}
        >
          <Link
            to="/"
            className="text-[1.05rem] font-semibold tracking-[-0.035em]"
            aria-label="Venfour home"
          >
            Venfour
          </Link>
          {analysisRoute ? (
            <span className="text-xs font-medium tracking-[0.12em] text-neutral-500 uppercase">
              Valuation review
            </span>
          ) : null}
        </div>
      </header>
      <main className="flex flex-1">
        <Outlet />
      </main>
      {!analysisRoute ? (
        <footer className="border-t">
          <div className="mx-auto w-full max-w-6xl px-6 py-5 text-sm text-muted-foreground">
            Independent vehicle-valuation guidance for total-loss claims.
          </div>
        </footer>
      ) : null}
    </div>
  );
}
