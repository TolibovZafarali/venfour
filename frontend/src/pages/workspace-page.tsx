import { Button } from "@/components/ui/button";
import { useHealthQuery } from "@/features/system/queries";

export function WorkspacePage() {
  const healthQuery = useHealthQuery();

  const connectionMessage = healthQuery.isPending
    ? "Checking backend connection…"
    : healthQuery.isSuccess
      ? "Backend connection is available."
      : "Backend connection is not available.";

  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-12 md:py-16">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Workspace placeholder
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Your valuation workspace
        </h1>
        <p className="mt-4 leading-7 text-muted-foreground">
          The customer workflow is intentionally deferred. This route proves
          that the application shell, routing, query provider, and backend
          boundary are ready for the next frontend phase.
        </p>
      </div>

      <div className="mt-10 max-w-2xl rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="font-semibold">System connection</h2>
        <p className="mt-2 text-sm text-muted-foreground" role="status">
          {connectionMessage}
        </p>
        {healthQuery.isError ? (
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => void healthQuery.refetch()}
          >
            Check again
          </Button>
        ) : null}
      </div>
    </section>
  );
}
