import { act, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useHomeSmoothScroll } from "./use-home-smooth-scroll";

let position: number;
let motion: MediaQueryList;

beforeEach(() => {
  vi.useFakeTimers();
  position = 0;
  motion = Object.assign(new EventTarget(), {
    matches: false,
    media: "(prefers-reduced-motion: reduce)",
  }) as MediaQueryList;
  vi.stubGlobal("matchMedia", vi.fn(() => motion));
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal("innerHeight", 800);
  vi.stubGlobal("Window", class {
    static [Symbol.hasInstance](value: unknown) { return value === window; }
  });
  vi.spyOn(window, "scrollY", "get").mockImplementation(() => position);
  vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(5000);
  vi.spyOn(window, "scrollTo").mockImplementation((options: ScrollToOptions | number) => {
    if (typeof options === "object") position = options.top ?? position;
  });
});

afterEach(() => {
  document.body.removeAttribute("data-scroll-locked");
  document.documentElement.style.removeProperty("scroll-padding-top");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function wheel() {
  const event = new WheelEvent("wheel", { deltaY: 600, bubbles: true, cancelable: true });
  fireEvent(window, event);
  return event;
}

describe("homepage smooth scrolling", () => {
  it("eases wheel input and cancels remaining movement when leaving the homepage", () => {
    const { rerender, unmount } = renderHook(({ enabled }) => useHomeSmoothScroll(enabled), {
      initialProps: { enabled: true },
    });

    expect(wheel().defaultPrevented).toBe(true);
    expect(position).toBe(0);
    act(() => vi.advanceTimersByTime(200));
    expect(position).toBeGreaterThan(0);
    expect(position).toBeLessThan(600);

    rerender({ enabled: false });
    const stoppedAt = position;
    act(() => vi.advanceTimersByTime(2000));
    expect(position).toBe(stoppedAt);
    expect(wheel().defaultPrevented).toBe(false);
    expect(document.documentElement).not.toHaveClass("lenis");
    unmount();
  });

  it("respects section scroll spacing and lets keyboard input interrupt the glide", () => {
    const target = document.createElement("section");
    target.style.scrollMarginTop = "96px";
    document.documentElement.style.scrollPaddingTop = "80px";
    document.body.append(target);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ top: 1600 } as DOMRect);
    const { result, unmount } = renderHook(() => useHomeSmoothScroll(true));

    act(() => result.current(target));
    act(() => vi.advanceTimersByTime(1200));
    expect(position).toBe(1424);

    wheel();
    act(() => vi.advanceTimersByTime(160));
    fireEvent.keyDown(window, { key: "Home" });
    const stoppedAt = position;
    act(() => vi.advanceTimersByTime(2000));
    expect(position).toBe(stoppedAt);
    unmount();
    target.remove();
  });

  it("does not restore scroll classes after a native scroll ends on another page", () => {
    const { rerender, unmount } = renderHook(({ enabled }) => useHomeSmoothScroll(enabled), {
      initialProps: { enabled: true },
    });
    position = 200;
    fireEvent.scroll(window);
    expect(document.documentElement).toHaveClass("lenis-scrolling");

    rerender({ enabled: false });
    act(() => vi.advanceTimersByTime(1000));
    expect(document.documentElement).not.toHaveClass("lenis");
    unmount();
  });

  it("uses native scrolling for reduced motion, including live preference changes", () => {
    Object.assign(motion, { matches: true });
    const { unmount } = renderHook(() => useHomeSmoothScroll(true));
    expect(document.documentElement).not.toHaveClass("lenis");
    expect(wheel().defaultPrevented).toBe(false);

    act(() => {
      Object.assign(motion, { matches: false });
      motion.dispatchEvent(new Event("change"));
    });
    wheel();
    act(() => vi.advanceTimersByTime(160));
    act(() => {
      Object.assign(motion, { matches: true });
      motion.dispatchEvent(new Event("change"));
    });
    const stoppedAt = position;
    act(() => vi.advanceTimersByTime(2000));
    expect(position).toBe(stoppedAt);
    expect(wheel().defaultPrevented).toBe(false);
    unmount();
  });

  it("stops existing inertia while a dialog locks the page and resumes after dismissal", async () => {
    const { unmount } = renderHook(() => useHomeSmoothScroll(true));
    wheel();
    act(() => vi.advanceTimersByTime(160));

    await act(async () => document.body.setAttribute("data-scroll-locked", "1"));
    const stoppedAt = position;
    act(() => vi.advanceTimersByTime(2000));
    expect(position).toBe(stoppedAt);
    expect(document.documentElement).not.toHaveClass("lenis");

    await act(async () => document.body.removeAttribute("data-scroll-locked"));
    expect(document.documentElement).toHaveClass("lenis");
    wheel();
    act(() => vi.advanceTimersByTime(2000));
    expect(position).toBeCloseTo(stoppedAt + 600);
    unmount();
  });
});
