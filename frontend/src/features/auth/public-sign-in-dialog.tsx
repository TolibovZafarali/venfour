import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";

import { APPLICATION_ORIGIN } from "@/app/site-boundary";
import { PUBLIC_SIGN_IN_PATH, publicSignInAction } from "./public-sign-in";

export function PublicSignInDialog({ open, onOpenChange, restoreFocusElement }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restoreFocusElement?: HTMLElement | null;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const signInUrl = `${APPLICATION_ORIGIN}${PUBLIC_SIGN_IN_PATH}`;

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const action = publicSignInAction(event, frameRef.current?.contentWindow ?? null);
      if (action === "ready") setReady(true);
      if (action === "close") onOpenChange(false);
      if (action === "complete") window.location.assign(`${APPLICATION_ORIGIN}/app`);
      if (action === "google" || action === "apple") window.location.assign(`${signInUrl}?provider=${action}`);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onOpenChange, signInUrl]);

  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[70] bg-ink/32 backdrop-blur-[3px] data-[state=open]:animate-in data-[state=open]:fade-in motion-reduce:animate-none" />
      <Dialog.Content data-product-overlay className="fixed top-1/2 left-1/2 z-[71] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-line bg-white shadow-xl"
        onCloseAutoFocus={event => {
          if (restoreFocusElement) {
            event.preventDefault();
            queueMicrotask(() => restoreFocusElement.focus());
          }
        }}>
        <Dialog.Title className="sr-only">Sign in to Venfour</Dialog.Title>
        <Dialog.Description className="sr-only">Sign in to open your saved reviews.</Dialog.Description>
        <Dialog.Close asChild><button type="button" aria-label="Close sign in" className="report-action-focus absolute top-2 right-2 z-10 inline-flex size-11 items-center justify-center rounded-lg bg-white text-copy hover:bg-surface hover:text-ink"><X className="size-4" aria-hidden /></button></Dialog.Close>
        {!ready && <p role="status" className="absolute top-16 inset-x-6 text-sm text-copy">Loading sign in…</p>}
        <iframe ref={frameRef} title="Secure sign-in form" src={`${signInUrl}?parentOrigin=${encodeURIComponent(window.location.origin)}`}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          className="block h-[640px] max-h-[calc(100svh-7rem)] w-full border-0"
          style={{ visibility: ready ? "visible" : "hidden" }} />
        <div className="border-t border-line px-5 py-3 text-center text-xs text-copy">
          <a href={signInUrl} className="report-action-focus rounded-sm underline underline-offset-4">Open sign-in in a full page</a>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
