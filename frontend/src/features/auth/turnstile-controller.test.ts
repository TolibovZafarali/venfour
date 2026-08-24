import { describe, expect, it, vi } from "vitest";

import {
  createTurnstileController,
  type TurnstileApi,
} from "@/features/auth/turnstile-controller";

type RenderOptions = Parameters<TurnstileApi["render"]>[1];

function createApi(
  onExecute: (options: RenderOptions, widgetId: string) => void,
) {
  let nextWidgetId = 0;
  const optionsByWidget = new Map<string, RenderOptions>();
  const api: TurnstileApi = {
    execute: vi.fn((widgetId) => {
      const options = optionsByWidget.get(widgetId);
      if (!options) throw new Error("Unknown widget.");
      onExecute(options, widgetId);
    }),
    remove: vi.fn((widgetId) => {
      optionsByWidget.delete(widgetId);
    }),
    render: vi.fn((_container, options) => {
      nextWidgetId += 1;
      const widgetId = `widget-${nextWidgetId}`;
      optionsByWidget.set(widgetId, options);
      return widgetId;
    }),
  };
  return api;
}

describe("Turnstile controller", () => {
  it("executes an interaction-only widget and consumes a fresh token per operation", async () => {
    const tokens = ["single-use-token-1", "single-use-token-2"];
    const api = createApi((options) => {
      const token = tokens.shift();
      if (!token) throw new Error("No token available.");
      queueMicrotask(() => options.callback(token));
    });
    const controller = createTurnstileController({
      loadApi: async () => api,
      siteKey: "0x4AAAAAAATestManagedWidget000000",
    });
    const firstOperation = vi.fn(async (token: string) => `first:${token}`);
    const secondOperation = vi.fn(async (token: string) => `second:${token}`);

    await expect(
      controller.runWithToken("anonymous-auth", firstOperation),
    ).resolves.toBe("first:single-use-token-1");
    await expect(
      controller.runWithToken("magic-link", secondOperation),
    ).resolves.toBe("second:single-use-token-2");

    expect(firstOperation).toHaveBeenCalledWith("single-use-token-1");
    expect(secondOperation).toHaveBeenCalledWith("single-use-token-2");
    expect(api.render).toHaveBeenCalledTimes(2);
    expect(api.execute).toHaveBeenNthCalledWith(1, "widget-1");
    expect(api.execute).toHaveBeenNthCalledWith(2, "widget-2");
    expect(api.remove).toHaveBeenNthCalledWith(1, "widget-1");
    expect(api.remove).toHaveBeenNthCalledWith(2, "widget-2");
    expect(document.body.querySelector("[aria-live='polite']")).toBeNull();

    const firstOptions = vi.mocked(api.render).mock.calls[0]?.[1];
    const secondOptions = vi.mocked(api.render).mock.calls[1]?.[1];
    expect(firstOptions).toMatchObject({
      action: "anonymous-auth",
      appearance: "interaction-only",
      execution: "execute",
      "refresh-expired": "never",
      "refresh-timeout": "never",
      "response-field": false,
      retry: "auto",
      sitekey: "0x4AAAAAAATestManagedWidget000000",
    });
    expect(secondOptions?.action).toBe("magic-link");
  });

  it("allows Cloudflare automatic retries for retriable challenge errors", async () => {
    const api = createApi((options) => {
      queueMicrotask(() => {
        options["error-callback"]("300030");
        options["error-callback"]("600010");
        options.callback("token-after-retry");
      });
    });
    const operation = vi.fn(async () => "complete");
    const controller = createTurnstileController({
      loadApi: async () => api,
      siteKey: "0x4AAAAAAATestManagedWidget000000",
    });

    await expect(
      controller.runWithToken("anonymous-auth", operation),
    ).resolves.toBe("complete");
    expect(operation).toHaveBeenCalledWith("token-after-retry");
  });

  it.each([
    ["permanent error", (options: RenderOptions) => options["error-callback"]("110200")],
    ["expiry", (options: RenderOptions) => options["expired-callback"]()],
    ["timeout", (options: RenderOptions) => options["timeout-callback"]()],
    ["unsupported browser", (options: RenderOptions) => options["unsupported-callback"]()],
  ])("fails closed on %s and does not invoke the protected operation", async (_label, fail) => {
    const api = createApi((options) => queueMicrotask(() => fail(options)));
    const operation = vi.fn(async () => "must-not-run");
    const controller = createTurnstileController({
      loadApi: async () => api,
      siteKey: "0x4AAAAAAATestManagedWidget000000",
    });

    await expect(
      controller.runWithToken("magic-link", operation),
    ).rejects.toThrow(/security check|browser/u);
    expect(operation).not.toHaveBeenCalled();
    expect(api.remove).toHaveBeenCalledWith("widget-1");
    expect(document.body.querySelector("[aria-live='polite']")).toBeNull();
  });

  it("stops after repeated retriable failures", async () => {
    const api = createApi((options) => {
      queueMicrotask(() => {
        options["error-callback"]("300030");
        options["error-callback"]("300031");
        options["error-callback"]("300032");
      });
    });
    const operation = vi.fn(async () => "must-not-run");
    const controller = createTurnstileController({
      loadApi: async () => api,
      siteKey: "0x4AAAAAAATestManagedWidget000000",
    });

    await expect(
      controller.runWithToken("anonymous-auth", operation),
    ).rejects.toThrow("We couldn’t complete the security check");
    expect(operation).not.toHaveBeenCalled();
    expect(api.remove).toHaveBeenCalledWith("widget-1");
    expect(document.body.querySelector("[aria-live='polite']")).toBeNull();
  });

  it("does not start the protected operation before a token and cleans up on navigation", async () => {
    let renderedOptions: RenderOptions | undefined;
    const api = createApi((options) => {
      renderedOptions = options;
    });
    const operation = vi.fn(async () => "must-not-run");
    const controller = createTurnstileController({
      loadApi: async () => api,
      siteKey: "0x4AAAAAAATestManagedWidget000000",
    });

    const result = controller.runWithToken("magic-link", operation);
    await vi.waitFor(() => expect(renderedOptions).toBeDefined());
    expect(operation).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("pagehide"));

    await expect(result).rejects.toThrow("security check was interrupted");
    expect(operation).not.toHaveBeenCalled();
    expect(api.remove).toHaveBeenCalledWith("widget-1");
    expect(document.body.querySelector("[aria-live='polite']")).toBeNull();
  });

  it("cancels a pending challenge through an AbortSignal", async () => {
    const api = createApi(() => undefined);
    const operation = vi.fn(async () => "must-not-run");
    const abortController = new AbortController();
    const controller = createTurnstileController({
      loadApi: async () => api,
      siteKey: "0x4AAAAAAATestManagedWidget000000",
    });

    const result = controller.runWithToken(
      "anonymous-auth",
      operation,
      abortController.signal,
    );
    await vi.waitFor(() => expect(api.execute).toHaveBeenCalledOnce());
    abortController.abort();

    await expect(result).rejects.toThrow("security check was interrupted");
    expect(operation).not.toHaveBeenCalled();
    expect(api.remove).toHaveBeenCalledWith("widget-1");
    expect(document.body.querySelector("[aria-live='polite']")).toBeNull();
  });

  it("cancels while the Turnstile script API is still loading", async () => {
    let resolveApi!: (api: TurnstileApi) => void;
    const apiPromise = new Promise<TurnstileApi>((resolve) => {
      resolveApi = resolve;
    });
    const api = createApi(() => undefined);
    const operation = vi.fn(async () => "must-not-run");
    const abortController = new AbortController();
    const controller = createTurnstileController({
      loadApi: () => apiPromise,
      siteKey: "0x4AAAAAAATestManagedWidget000000",
    });

    const result = controller.runWithToken(
      "anonymous-auth",
      operation,
      abortController.signal,
    );
    abortController.abort();

    await expect(result).rejects.toThrow("security check was interrupted");
    expect(operation).not.toHaveBeenCalled();
    expect(document.body.querySelector("[aria-live='polite']")).toBeNull();
    resolveApi(api);
  });

  it("fails before loading Turnstile when the public site key is absent", async () => {
    const loadApi = vi.fn<() => Promise<TurnstileApi>>();
    const controller = createTurnstileController({ loadApi, siteKey: " " });

    await expect(
      controller.runWithToken("anonymous-auth", async () => undefined),
    ).rejects.toThrow("Security checks are unavailable");
    expect(loadApi).not.toHaveBeenCalled();
  });
});
