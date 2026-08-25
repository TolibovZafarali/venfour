import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import {
  publicPageGradientClassNames,
  type PublicPageTone,
} from "@/pages/page-gradients";

interface PublicPageProps {
  eyebrow: string;
  title: string;
  introduction: string;
  updated?: string;
  children: ReactNode;
  className?: string;
  tone: PublicPageTone;
}

export function PublicPage({
  eyebrow,
  title,
  introduction,
  updated,
  children,
  className,
  tone,
}: PublicPageProps) {
  return (
    <section
      className={cn(
        "public-page-gradient w-full bg-white",
        publicPageGradientClassNames[tone],
      )}
      data-public-page-tone={tone}
    >
      <div className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-8 sm:py-16 lg:py-20">
        <header className="max-w-3xl">
          <p className="flex items-center gap-3 text-xs font-semibold tracking-[0.14em] text-neutral-500 uppercase">
            <span className="h-px w-8 bg-neutral-400" aria-hidden />
            {eyebrow}
          </p>
          <h1 className="mt-5 text-4xl leading-[1.08] font-semibold tracking-[-0.04em] text-balance text-neutral-950 sm:text-5xl">
            {title}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-neutral-600 sm:text-lg sm:leading-8">
            {introduction}
          </p>
          {updated ? (
            <p className="mt-5 text-sm text-neutral-500">{updated}</p>
          ) : null}
        </header>

        <div className={cn("mt-12 max-w-3xl", className)}>{children}</div>
      </div>
    </section>
  );
}

interface PublicPageSectionProps {
  id?: string;
  title: string;
  children: ReactNode;
  className?: string;
}

export function PublicPageSection({
  id,
  title,
  children,
  className,
}: PublicPageSectionProps) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-24 border-t border-neutral-200 py-8 first:border-t-0 first:pt-0 sm:py-10",
        className,
      )}
    >
      <h2 className="text-xl font-semibold tracking-[-0.02em] text-neutral-950 sm:text-2xl">
        {title}
      </h2>
      <div className="mt-4 space-y-4 text-[0.9375rem] leading-7 text-neutral-600 sm:text-base">
        {children}
      </div>
    </section>
  );
}

export const publicTextLinkClassName =
  "font-medium text-brand underline decoration-brand/35 underline-offset-4 transition-colors hover:text-brand-strong hover:decoration-brand focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 motion-reduce:transition-none";
