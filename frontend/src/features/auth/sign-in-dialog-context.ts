import { createContext, useContext } from "react";

export interface OpenSignInOptions {
  returnTo?: string;
}

export interface SignInDialogContextValue {
  openSignIn: (options?: OpenSignInOptions) => void;
  closeSignIn: () => void;
}

export const SignInDialogContext =
  createContext<SignInDialogContextValue | null>(null);

export function useSignInDialog() {
  const context = useContext(SignInDialogContext);

  if (!context) {
    throw new Error(
      "useSignInDialog must be used inside SignInDialogProvider.",
    );
  }

  return context;
}
