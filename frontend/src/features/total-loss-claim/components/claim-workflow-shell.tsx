import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ClaimWorkflowFrame({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <section className="w-full bg-transparent">
      <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-14 lg:px-10 lg:py-16">
        {children}
      </div>
    </section>
  );
}

export function ClaimWorkflowCard({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[1.75rem] border border-line/80 bg-white p-6 shadow-[0_32px_90px_-56px_rgba(11,31,51,0.55)] sm:p-8 lg:p-10",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function WorkflowError({ children }: { readonly children: ReactNode }) {
  return (
    <p
      className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800"
      role="alert"
    >
      {children}
    </p>
  );
}
