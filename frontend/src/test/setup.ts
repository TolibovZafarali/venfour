import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { server } from "@/test/mocks/server";

function createMediaQueryList(query: string): MediaQueryList {
  const list = Object.assign(new EventTarget(), {
    matches: false,
    media: query,
    onchange: null as MediaQueryList["onchange"],
    addListener(listener: Parameters<MediaQueryList["addListener"]>[0]) {
      if (listener) list.addEventListener("change", listener as EventListener);
    },
    removeListener(listener: Parameters<MediaQueryList["removeListener"]>[0]) {
      if (listener) list.removeEventListener("change", listener as EventListener);
    },
  }) as MediaQueryList;
  list.addEventListener("change", (event) => list.onchange?.call(list, event));
  return list;
}

if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: createMediaQueryList satisfies Window["matchMedia"],
  });
}

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));

afterEach(() => {
  cleanup();
  server.resetHandlers();
  window.localStorage.clear();
});

afterAll(() => server.close());
