import { useEffect } from "react";
import { Navigate, useSearchParams } from "react-router";

import { isPermanentAuthState, useAuth } from "./auth-context";
import { EmbeddedSignIn } from "./sign-in-dialog";
import { PUBLIC_SIGN_IN_MESSAGE, PUBLIC_SIGN_IN_PARENTS } from "./public-sign-in";

export function PublicSignInFrame() {
  const { auth } = useAuth();
  const [search] = useSearchParams();
  const parentOrigin = search.get("parentOrigin");
  const embedded = window.parent !== window && parentOrigin !== null && PUBLIC_SIGN_IN_PARENTS.includes(parentOrigin);

  useEffect(() => {
    if (!embedded) return;
    window.parent.postMessage({ type: PUBLIC_SIGN_IN_MESSAGE, action: "ready" }, parentOrigin!);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") window.parent.postMessage({ type: PUBLIC_SIGN_IN_MESSAGE, action: "close" }, parentOrigin!);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [embedded, parentOrigin]);

  useEffect(() => {
    if (embedded && isPermanentAuthState(auth)) {
      window.parent.postMessage({ type: PUBLIC_SIGN_IN_MESSAGE, action: "complete" }, parentOrigin!);
    }
  }, [auth, embedded, parentOrigin]);

  if (!embedded) return <Navigate to="/app" replace />;

  const notifyParent = (action: string) => window.parent.postMessage({ type: PUBLIC_SIGN_IN_MESSAGE, action }, parentOrigin!);
  return <div className="bg-white">
    <EmbeddedSignIn open onOpenChange={() => {}} returnTo="/app"
      onOAuthStart={notifyParent}
      onNavigate={() => notifyParent("complete")} />
  </div>;
}
