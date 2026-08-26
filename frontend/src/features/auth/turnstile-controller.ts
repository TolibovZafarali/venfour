import { environment } from "@/config/env";

const TURNSTILE_SCRIPT_ID = "cloudflare-turnstile-api";
const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_LOAD_TIMEOUT_MS = 15_000;
const CHALLENGE_TIMEOUT_MS = 120_000;
const MAX_RETRIABLE_ERRORS = 3;

export type TurnstileAction =
  | "anonymous-auth"
  | "claim-recovery"
  | "magic-link";

export interface TurnstileController {
  runWithToken<T>(
    action: TurnstileAction,
    operation: (captchaToken: string) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T>;
}

interface TurnstileRenderOptions {
  action: TurnstileAction;
  appearance: "interaction-only";
  callback: (token: string) => void;
  execution: "execute";
  "error-callback": (errorCode?: string) => void;
  "expired-callback": () => void;
  "refresh-expired": "never";
  "refresh-timeout": "never";
  "response-field": false;
  retry: "auto";
  "retry-interval": number;
  sitekey: string;
  theme: "auto";
  "timeout-callback": () => void;
  "unsupported-callback": () => void;
}

export interface TurnstileApi {
  execute(widgetId: string): void;
  remove(widgetId: string): void;
  render(container: HTMLElement, options: TurnstileRenderOptions): string;
}

interface TurnstileControllerOptions {
  document?: Document;
  loadApi?: () => Promise<TurnstileApi>;
  siteKey: string;
  window?: Window;
}

type TurnstileWindow = Window & { turnstile?: TurnstileApi };

let browserApiPromise: Promise<TurnstileApi> | null = null;

function interruptedError() {
  return new Error("The security check was interrupted. Please try again.");
}

function waitUnlessAborted<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(interruptedError());

  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => {
      cleanup();
      reject(interruptedError());
    };
    const cleanup = () => signal.removeEventListener("abort", handleAbort);

    signal.addEventListener("abort", handleAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function currentBrowserApi(windowObject: Window) {
  return (windowObject as TurnstileWindow).turnstile;
}

async function loadBrowserApi(
  documentObject: Document,
  windowObject: Window,
) {
  const availableApi = currentBrowserApi(windowObject);
  if (availableApi) return availableApi;
  if (browserApiPromise) return browserApiPromise;

  const scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    let script = documentObject.getElementById(
      TURNSTILE_SCRIPT_ID,
    ) as HTMLScriptElement | null;
    const createdScript = !script;
    script ??= documentObject.createElement("script");
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.defer = true;

    const cleanup = () => {
      clearTimeout(timeoutId);
      script.removeEventListener("load", handleLoad);
      script.removeEventListener("error", handleError);
    };
    const handleLoad = () => {
      cleanup();
      const api = currentBrowserApi(windowObject);
      if (api) {
        resolve(api);
      } else {
        if (createdScript) script.remove();
        reject(new Error("The security check did not initialize."));
      }
    };
    const handleError = () => {
      cleanup();
      if (createdScript) script.remove();
      reject(
        new Error(
          "We couldn’t load the security check. Check your connection and try again.",
        ),
      );
    };
    const timeoutId = windowObject.setTimeout(() => {
      cleanup();
      if (createdScript) script.remove();
      reject(
        new Error(
          "We couldn’t load the security check. Check your connection and try again.",
        ),
      );
    }, SCRIPT_LOAD_TIMEOUT_MS);

    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });
    if (createdScript) documentObject.head.append(script);
  });

  browserApiPromise = scriptPromise;
  try {
    return await scriptPromise;
  } catch (error) {
    if (browserApiPromise === scriptPromise) browserApiPromise = null;
    throw error;
  }
}

function createChallengeContainer(documentObject: Document) {
  const container = documentObject.createElement("div");
  container.setAttribute("aria-live", "polite");
  container.style.position = "fixed";
  container.style.right = "1rem";
  container.style.bottom = "1rem";
  container.style.zIndex = "2147483647";
  documentObject.body.append(container);
  return container;
}

function isRetriableError(errorCode?: string) {
  if (!errorCode) return false;
  return (
    errorCode === "110600" ||
    errorCode === "110620" ||
    errorCode === "200500" ||
    errorCode.startsWith("300") ||
    errorCode.startsWith("600")
  );
}

export function createTurnstileController({
  document: documentOption,
  loadApi,
  siteKey,
  window: windowOption,
}: TurnstileControllerOptions): TurnstileController {
  return {
    async runWithToken(action, operation, signal) {
      const normalizedSiteKey = siteKey.trim();
      if (!normalizedSiteKey) {
        throw new Error(
          "Security checks are unavailable. Please try again later.",
        );
      }

      const documentObject = documentOption ?? globalThis.document;
      const windowObject = windowOption ?? globalThis.window;
      if (!documentObject || !windowObject) {
        throw new Error("Security checks require a browser.");
      }

      const api = await waitUnlessAborted(
        loadApi?.() ?? loadBrowserApi(documentObject, windowObject),
        signal,
      );
      const container = createChallengeContainer(documentObject);
      let widgetId: string | null = null;

      try {
        const captchaToken = await new Promise<string>((resolve, reject) => {
          let settled = false;
          let retriableErrorCount = 0;
          const finish = (callback: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(challengeTimeoutId);
            windowObject.removeEventListener("pagehide", handlePageHide);
            signal?.removeEventListener("abort", handleAbort);
            callback();
          };
          const rejectWith = (message: string) =>
            finish(() => reject(new Error(message)));
          const handlePageHide = () =>
            rejectWith("The security check was interrupted. Please try again.");
          const handleAbort = () =>
            rejectWith("The security check was interrupted. Please try again.");
          const challengeTimeoutId = windowObject.setTimeout(
            () =>
              rejectWith("The security check timed out. Please try again."),
            CHALLENGE_TIMEOUT_MS,
          );

          windowObject.addEventListener("pagehide", handlePageHide, {
            once: true,
          });
          signal?.addEventListener("abort", handleAbort, { once: true });
          if (signal?.aborted) {
            handleAbort();
            return;
          }

          try {
            widgetId = api.render(container, {
              action,
              appearance: "interaction-only",
              callback: (token) => {
                if (!token.trim()) {
                  rejectWith(
                    "The security check did not return a valid response. Please try again.",
                  );
                  return;
                }
                finish(() => resolve(token));
              },
              execution: "execute",
              "error-callback": (errorCode) => {
                if (
                  isRetriableError(errorCode) &&
                  ++retriableErrorCount < MAX_RETRIABLE_ERRORS
                ) {
                  return;
                }
                rejectWith(
                  "We couldn’t complete the security check. Please try again.",
                );
              },
              "expired-callback": () =>
                rejectWith("The security check expired. Please try again."),
              "refresh-expired": "never",
              "refresh-timeout": "never",
              "response-field": false,
              retry: "auto",
              "retry-interval": 2_000,
              sitekey: normalizedSiteKey,
              theme: "auto",
              "timeout-callback": () =>
                rejectWith("The security check timed out. Please try again."),
              "unsupported-callback": () =>
                rejectWith(
                  "This browser cannot run the security check. Please use a supported browser and try again.",
                ),
            });
            api.execute(widgetId);
          } catch {
            rejectWith(
              "We couldn’t start the security check. Please try again.",
            );
          }
        });

        if (signal?.aborted) throw interruptedError();
        return await operation(captchaToken);
      } finally {
        if (widgetId !== null) {
          try {
            api.remove(widgetId);
          } catch {
            // The widget may already have removed itself during navigation.
          }
        }
        container.remove();
      }
    },
  };
}

let testTokenSequence = 0;
const testController: TurnstileController = {
  runWithToken(action, operation, signal) {
    if (signal?.aborted) return Promise.reject(interruptedError());
    testTokenSequence += 1;
    return operation(`turnstile-test-${action}-${testTokenSequence}`);
  },
};

export const defaultTurnstileController =
  import.meta.env.MODE === "test"
    ? testController
    : createTurnstileController({ siteKey: environment.turnstileSiteKey });
