import type { ReactNode } from "react";

export function StableActionLabel({ children, reserve }: { readonly children: ReactNode; readonly reserve: string }) {
  return (
    <span className="stable-action-label">
      <span className="stable-action-label-reserve" aria-hidden="true" data-label={reserve} />
      <span>{children}</span>
    </span>
  );
}
