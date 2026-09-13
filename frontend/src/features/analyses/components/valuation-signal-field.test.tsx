import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ValuationSignalField } from "./valuation-signal-field";

let callbacks: Map<number, FrameRequestCallback>;
let frameId: number;
let now: number;
const drawing = { clearRect: vi.fn(), setTransform: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn() };
function advance(count: number) {
  for (let i = 0; i < count; i++) {
    now += 16;
    const pending = [...callbacks.values()]; callbacks.clear();
    pending.forEach(callback => callback(now));
  }
}
beforeEach(() => {
  callbacks = new Map(); frameId = 0; now = 0;
  vi.stubGlobal("requestAnimationFrame", vi.fn(callback => { callbacks.set(++frameId, callback); return frameId; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn(id => callbacks.delete(id)));
  vi.stubGlobal("matchMedia", vi.fn(query => ({matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn()})));
  vi.stubGlobal("ResizeObserver", undefined); vi.stubGlobal("IntersectionObserver", undefined);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(drawing as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({width: 800, height: 600, top: 0, left: 0} as DOMRect);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("keeps the gathered field, releases it outward, then stops scheduling frames", () => {
  const view = render(<ValuationSignalField />);
  const canvas = view.container.querySelector("canvas");
  act(() => advance(420));
  expect(callbacks.size).toBe(1);
  expect(drawing.arc).toHaveBeenCalled();
  view.rerender(<ValuationSignalField exiting />);
  expect(view.container.querySelector("canvas")).toBe(canvas);
  expect(canvas).toHaveAttribute("data-signal-phase", "exiting");
  act(() => advance(130));
  expect(callbacks.size).toBe(0);
  expect(canvas).toHaveAttribute("aria-hidden", "true");
  view.rerender(<ValuationSignalField />);
  act(() => advance(3));
  expect(callbacks.size).toBe(1);
});

it("settles immediately without an animation loop for reduced motion", () => {
  vi.mocked(window.matchMedia).mockImplementation(query => ({matches: query.includes("reduced-motion"), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn()} as unknown as MediaQueryList));
  const view = render(<ValuationSignalField />);
  expect(callbacks.size).toBe(0);
  view.rerender(<ValuationSignalField exiting />);
  expect(callbacks.size).toBe(0);
  expect(drawing.clearRect).toHaveBeenCalled();
});
