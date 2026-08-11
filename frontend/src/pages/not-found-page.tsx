import { Link } from "react-router";

import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col items-start px-6 py-20">
      <p className="text-sm font-semibold text-muted-foreground">404</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        Page not found
      </h1>
      <p className="mt-4 text-muted-foreground">
        The page you requested does not exist.
      </p>
      <Button asChild className="mt-7" variant="outline">
        <Link to="/">Return home</Link>
      </Button>
    </section>
  );
}
