import {
  AlertCircle,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";

interface ClaimStateCardProps {
  readonly children?: ReactNode;
  readonly description: string;
  readonly eyebrow?: string;
  readonly heading: string;
  readonly kind?: "error" | "loading" | "secure";
}

export function ClaimStateCard({
  children,
  description,
  eyebrow = "Secure claim access",
  heading,
  kind = "secure",
}: ClaimStateCardProps) {
  const Icon =
    kind === "loading"
      ? LoaderCircle
      : kind === "error"
        ? AlertCircle
        : ShieldCheck;

  return (
    <section className="mx-auto flex min-h-[60vh] w-full max-w-3xl items-center px-5 py-12 sm:px-8 sm:py-20">
      <div
        className="w-full rounded-[1.75rem] border border-line/80 bg-white p-6 shadow-[0_32px_90px_-56px_rgba(11,31,51,0.55)] sm:p-8 lg:p-10"
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
        {children ? <div className="mt-7">{children}</div> : null}
      </div>
    </section>
  );
}
