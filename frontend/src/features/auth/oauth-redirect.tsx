import { useEffect, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router";

import { isPermanentAuthState, useAuth } from "./auth-context";
import { getFriendlyAuthError } from "./auth-errors";

export function OAuthRedirect() {
  const { auth, signInWithGoogle, signInWithApple } = useAuth();
  const [search] = useSearchParams();
  const provider = search.get("provider");
  const supported = provider === "google" || provider === "apple";
  const topLevel = window.parent === window;
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!topLevel || !supported || auth.status === "loading" || auth.status === "unavailable" || isPermanentAuthState(auth) || started.current) return;
    started.current = true;
    const signIn = provider === "google" ? signInWithGoogle : signInWithApple;
    void signIn({ returnTo: "/app" }).catch(failure => setError(getFriendlyAuthError(failure, provider)));
  }, [auth, provider, signInWithApple, signInWithGoogle, supported, topLevel]);

  if (!topLevel || !supported || isPermanentAuthState(auth)) return <Navigate to="/app" replace />;
  if (error || auth.status === "unavailable") {
    const message = error ?? "Sign in is temporarily unavailable. Please try again later.";
    return <Navigate to={`/auth/callback?error_description=${encodeURIComponent(message)}`} replace />;
  }
  return <p role="status" className="p-6 text-center text-sm text-copy">Connecting to {provider === "google" ? "Google" : "Apple"}…</p>;
}
