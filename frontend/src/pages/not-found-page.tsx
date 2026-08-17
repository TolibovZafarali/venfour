import { Link } from "react-router";

import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col items-start px-5 py-20 sm:px-8 sm:py-28">
      <p className="text-xs font-semibold tracking-[0.14em] text-neutral-500 uppercase">
        Page unavailable
      </p>
      <h1 className="mt-4 text-3xl font-semibold tracking-[-0.035em] text-neutral-950 sm:text-4xl">
        Page not found
      </h1>
      <p className="mt-4 max-w-lg leading-7 text-neutral-600">
        The address may be incorrect, or the page may have moved. You can return
        to Venfour and start a valuation review.
      </p>
      <Button asChild className="mt-7" size="lg" variant="outline">
        <Link to="/">Return home</Link>
      </Button>
    </section>
  );
}
