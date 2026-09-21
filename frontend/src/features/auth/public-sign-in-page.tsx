import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { isPermanentAuthState, useAuth } from "./auth-context";
import { getFriendlyAuthError } from "./auth-errors";
import { EmbeddedSignIn } from "./sign-in-dialog";
import { PUBLIC_SIGN_IN_MESSAGE, PUBLIC_SIGN_IN_PARENTS } from "./public-sign-in";

export function PublicSignInPage() {
  const { auth, signInWithGoogle, signInWithApple } = useAuth();
  const [search] = useSearchParams();
  const parentOrigin = search.get("parentOrigin");
  const embedded = window.parent !== window && parentOrigin !== null && PUBLIC_SIGN_IN_PARENTS.includes(parentOrigin);
  const provider = search.get("provider");
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

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
    if (auth.status === "loading" || auth.status === "unavailable" || started.current) return;
    if (isPermanentAuthState(auth)) {
      started.current = true;
      if (embedded) window.parent.postMessage({ type: PUBLIC_SIGN_IN_MESSAGE, action: "complete" }, parentOrigin!);
      else window.location.replace("/app");
      return;
    }
    if (embedded || (provider !== "google" && provider !== "apple")) return;
    started.current = true;
    const signIn = provider === "google" ? signInWithGoogle : signInWithApple;
    void signIn({ returnTo: "/app" }).catch(failure => setError(getFriendlyAuthError(failure, provider)));
  }, [auth, embedded, parentOrigin, provider, signInWithApple, signInWithGoogle]);

  const notifyParent = (action: string) => window.parent.postMessage({ type: PUBLIC_SIGN_IN_MESSAGE, action }, parentOrigin!);
  return <div className={embedded ? "bg-white" : "mx-auto mt-8 max-w-md bg-white"}>
    {error && <p role="alert" className="px-6 pt-6 text-sm text-red-700">{error}</p>}
    <EmbeddedSignIn open onOpenChange={() => {}} returnTo="/app"
      onOAuthStart={embedded ? notifyParent : undefined}
      onNavigate={embedded ? () => notifyParent("complete") : destination => window.location.replace(destination)} />
  </div>;
}
