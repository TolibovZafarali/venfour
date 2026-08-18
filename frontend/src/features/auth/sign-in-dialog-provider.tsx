import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { SignInDialog } from "@/features/auth/sign-in-dialog";
import {
  SignInDialogContext,
  type OpenSignInOptions,
  type SignInDialogContextValue,
} from "@/features/auth/sign-in-dialog-context";

interface OpenDialogState {
  key: number;
  restoreFocusElement: HTMLElement | null;
  returnTo?: string;
}

interface SignInDialogProviderProps {
  children: ReactNode;
}

export function SignInDialogProvider({
  children,
}: SignInDialogProviderProps) {
  const [dialog, setDialog] = useState<OpenDialogState | null>(null);
  const nextDialogKeyRef = useRef(0);

  const openSignIn = useCallback((options?: OpenSignInOptions) => {
    nextDialogKeyRef.current += 1;
    setDialog({
      key: nextDialogKeyRef.current,
      restoreFocusElement:
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
      returnTo: options?.returnTo,
    });
  }, []);

  const closeSignIn = useCallback(() => setDialog(null), []);
  const value = useMemo<SignInDialogContextValue>(
    () => ({ closeSignIn, openSignIn }),
    [closeSignIn, openSignIn],
  );

  return (
    <SignInDialogContext.Provider value={value}>
      {children}
      {dialog ? (
        <SignInDialog
          key={dialog.key}
          open
          onOpenChange={(open) => {
            if (!open) {
              closeSignIn();
            }
          }}
          restoreFocusElement={dialog.restoreFocusElement}
          returnTo={dialog.returnTo}
        />
      ) : null}
    </SignInDialogContext.Provider>
  );
}
