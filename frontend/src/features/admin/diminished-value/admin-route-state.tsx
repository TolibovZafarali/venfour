import {
  AlertCircle,
  FileQuestion,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";

interface AdminRouteStateProps {
  readonly children?: ReactNode;
  readonly description: string;
  readonly eyebrow: string;
  readonly heading: string;
  readonly kind?: "error" | "loading" | "secure" | "unavailable";
}

export function AdminRouteState({
  children,
  description,
  eyebrow,
  heading,
  kind = "secure",
}: AdminRouteStateProps) {
  const Icon =
    kind === "loading"
      ? LoaderCircle
      : kind === "error"
        ? AlertCircle
        : kind === "unavailable"
          ? FileQuestion
          : ShieldCheck;

  return (
    <section className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center px-5 py-16 sm:px-8 sm:py-24">
      <div
        className="w-full rounded-2xl border border-line bg-white p-6 shadow-sm sm:p-8"
        role={kind === "error" ? "alert" : undefined}
        aria-live={kind === "loading" ? "polite" : undefined}
        aria-busy={kind === "loading" ? true : undefined}
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand">
          <Icon
            className={
              kind === "loading"
                ? "size-6 animate-spin motion-reduce:animate-none"
                : "size-6"
            }
            aria-hidden
          />
        </span>
        <p className="mt-6 text-sm font-semibold tracking-[0.12em] text-brand uppercase">
          {eyebrow}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-ink sm:text-4xl">
          {heading}
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-copy">
          {description}
        </p>
        {children ? (
          <div className="mt-7 flex flex-wrap gap-3">{children}</div>
        ) : null}
      </div>
    </section>
  );
}
