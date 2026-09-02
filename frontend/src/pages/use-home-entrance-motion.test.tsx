import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useHomeEntranceMotion } from "./use-home-entrance-motion";

class ControlledObserver implements IntersectionObserver {
  readonly root = null;
  readonly scrollMargin = "0px";
  readonly rootMargin: string;
  readonly thresholds: number[];
  readonly targets = new Set<Element>();
  readonly observe = vi.fn((target: Element) => { this.targets.add(target); });
  readonly unobserve = vi.fn((target: Element) => { this.targets.delete(target); });
  readonly disconnect = vi.fn(() => { this.targets.clear(); });
  readonly takeRecords = vi.fn((): IntersectionObserverEntry[] => []);
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
    this.callback = callback;
    this.rootMargin = options.rootMargin ?? "0px";
    this.thresholds = Array.isArray(options.threshold) ? options.threshold : [options.threshold ?? 0];
    observers.push(this);
  }

  notify(target: Element, isIntersecting = true, intersectionRatio = 0.01) {
    const bounds = target.getBoundingClientRect();
    this.callback([{
      target,
      isIntersecting,
      intersectionRatio,
      boundingClientRect: bounds,
      intersectionRect: bounds,
      rootBounds: null,
      time: 0,
    }], this);
  }
}

function createMotionPreference() {
  return Object.assign(new EventTarget(), {
    matches: false,
    media: "(prefers-reduced-motion: reduce)",
  });
}

let observers: ControlledObserver[];
let motion: ReturnType<typeof createMotionPreference>;

function HomeMotion() {
  const root = useRef<HTMLDivElement>(null);
  useHomeEntranceMotion(root);

  return (
    <div ref={root} data-home-motion data-testid="motion-root">
      <section aria-label="Services" tabIndex={-1}>
        <h2 data-home-entrance="heading" data-anchor-heading data-home-order="0">Services heading</h2>
        <p data-home-entrance="copy" data-home-order="1">Service explanation</p>
        <figure data-home-entrance="visual" data-home-order="2" aria-label="Service illustration">
          <span data-home-entrance="supporting">Nested illustration label</span>
        </figure>
        <div data-home-entrance="supporting" data-home-order="3" data-testid="actions">
          <button type="button">Start a review</button>
        </div>
      </section>
      <section aria-label="Process" tabIndex={-1}>
        <h2 data-home-entrance="heading" data-anchor-heading>Process heading</h2>
      </section>
    </div>
  );
}

function currentObserver() {
  const observer = observers.at(-1);
  if (!observer) throw new Error("Expected the homepage intersection observer");
  return observer;
}

function finishAnimation(target: HTMLElement, name: string) {
  const event = new Event("animationend", { bubbles: true });
  Object.defineProperty(event, "animationName", { value: name });
  fireEvent(target, event);
}

beforeEach(() => {
  observers = [];
  motion = createMotionPreference();
  vi.stubGlobal("IntersectionObserver", ControlledObserver);
  vi.stubGlobal("matchMedia", vi.fn(() => motion));
  vi.stubGlobal("innerHeight", 1000);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("homepage entrance behavior", () => {
  it("keeps content pending when it mounts above a stale scroll position", () => {
    vi.stubGlobal("scrollY", 700);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0, y: -200, top: -200, bottom: -100, left: 0, right: 300,
      width: 300, height: 100, toJSON: () => ({}),
    });

    render(<HomeMotion />);
    const heading = screen.getByRole("heading", { name: "Services heading" });

    expect(heading).toHaveAttribute("data-home-reveal", "pending");
    expect(currentObserver().targets.has(heading)).toBe(true);
    act(() => currentObserver().notify(heading, false, 0));
    expect(heading).toHaveAttribute("data-home-reveal", "pending");
  });

  it("reveals at the viewport boundary without requiring a fraction of a large target", () => {
    render(<HomeMotion />);
    const illustration = screen.getByRole("figure", { name: "Service illustration" });
    const observer = currentObserver();

    expect(observer.rootMargin).toBe("0px 0px -160px 0px");
    expect(observer.thresholds).toEqual([0]);
    act(() => observer.notify(illustration, false, 0));
    expect(illustration).toHaveAttribute("data-home-reveal", "pending");
    act(() => observer.notify(illustration, true, 0.001));
    expect(illustration).toHaveAttribute("data-home-reveal", "entering");
    expect(observer.targets.has(illustration)).toBe(false);
  });

  it("keeps local entrance delays stable across separate intersection callbacks", () => {
    render(<HomeMotion />);
    const heading = screen.getByRole("heading", { name: "Services heading" });
    const explanation = screen.getByText("Service explanation");
    const illustration = screen.getByRole("figure", { name: "Service illustration" });
    const actions = screen.getByTestId("actions");
    const observer = currentObserver();

    act(() => observer.notify(illustration));
    act(() => observer.notify(explanation));
    act(() => observer.notify(heading));
    act(() => observer.notify(actions));

    expect(heading.style.getPropertyValue("--home-entrance-delay")).toBe("0ms");
    expect(explanation.style.getPropertyValue("--home-entrance-delay")).toBe("80ms");
    expect(illustration.style.getPropertyValue("--home-entrance-delay")).toBe("160ms");
    expect(actions.style.getPropertyValue("--home-entrance-delay")).toBe("240ms");
  });

  it("does not animate a nested target independently of its visual parent", () => {
    render(<HomeMotion />);
    const illustration = screen.getByRole("figure", { name: "Service illustration" });
    const nestedLabel = screen.getByText("Nested illustration label");

    expect(currentObserver().targets.has(illustration)).toBe(true);
    expect(currentObserver().targets.has(nestedLabel)).toBe(false);
    expect(nestedLabel).not.toHaveAttribute("data-home-reveal");
  });

  it("makes an anchor heading readable without revealing the rest of its section", () => {
    render(<HomeMotion />);
    const section = screen.getByRole("region", { name: "Services" });
    const heading = screen.getByRole("heading", { name: "Services heading" });
    const explanation = screen.getByText("Service explanation");
    const illustration = screen.getByRole("figure", { name: "Service illustration" });

    act(() => section.focus());

    expect(section).toHaveFocus();
    expect(heading).not.toHaveAttribute("data-home-reveal");
    expect(currentObserver().targets.has(heading)).toBe(false);
    expect(explanation).toHaveAttribute("data-home-reveal", "pending");
    expect(illustration).toHaveAttribute("data-home-reveal", "pending");
    expect(screen.getByRole("heading", { name: "Process heading" })).toHaveAttribute("data-home-reveal", "pending");
  });

  it("makes a focused control readable without advancing nearby content", () => {
    render(<HomeMotion />);
    const actions = screen.getByTestId("actions");
    act(() => currentObserver().notify(actions));

    act(() => screen.getByRole("button", { name: "Start a review" }).focus());

    expect(actions).not.toHaveAttribute("data-home-reveal");
    expect(actions.style.getPropertyValue("--home-entrance-delay")).toBe("");
    expect(screen.getByText("Service explanation")).toHaveAttribute("data-home-reveal", "pending");
  });

  it("updates the viewport boundary on resize without replaying or losing pending content", () => {
    render(<HomeMotion />);
    const heading = screen.getByRole("heading", { name: "Services heading" });
    const explanation = screen.getByText("Service explanation");
    const originalObserver = currentObserver();
    act(() => originalObserver.notify(heading));

    vi.stubGlobal("innerHeight", 600);
    fireEvent(window, new Event("resize"));
    const resizedObserver = currentObserver();

    expect(originalObserver.disconnect).toHaveBeenCalled();
    expect(resizedObserver.rootMargin).toBe("0px 0px -96px 0px");
    expect(resizedObserver.targets.has(heading)).toBe(false);
    expect(resizedObserver.targets.has(explanation)).toBe(true);
    expect(explanation).toHaveAttribute("data-home-reveal", "pending");
    act(() => resizedObserver.notify(explanation));
    expect(explanation).toHaveAttribute("data-home-reveal", "entering");
  });

  it("clears reveal state at focus resolution and does not replay a settled target", () => {
    render(<HomeMotion />);
    const explanation = screen.getByText("Service explanation");
    const observer = currentObserver();
    act(() => observer.notify(explanation));

    finishAnimation(explanation, "unrelated-animation");
    expect(explanation).toHaveAttribute("data-home-reveal", "entering");
    finishAnimation(explanation, "home-focus-enter");
    expect(explanation).not.toHaveAttribute("data-home-reveal");
    expect(explanation.style.getPropertyValue("--home-entrance-delay")).toBe("");
    act(() => observer.notify(explanation));
    expect(explanation).not.toHaveAttribute("data-home-reveal");
  });

  it("leaves content visible when reduced motion is already requested", () => {
    motion.matches = true;
    render(<HomeMotion />);

    expect(screen.getByRole("heading", { name: "Services heading" })).not.toHaveAttribute("data-home-reveal");
    expect(screen.getByText("Service explanation")).not.toHaveAttribute("data-home-reveal");
    expect(observers).toHaveLength(0);
  });

  it("settles pending and active content when reduced motion is enabled live", () => {
    render(<HomeMotion />);
    const heading = screen.getByRole("heading", { name: "Services heading" });
    const explanation = screen.getByText("Service explanation");
    const observer = currentObserver();
    act(() => observer.notify(heading));

    act(() => {
      motion.matches = true;
      motion.dispatchEvent(new Event("change"));
    });

    expect(observer.disconnect).toHaveBeenCalled();
    expect(heading).not.toHaveAttribute("data-home-reveal");
    expect(explanation).not.toHaveAttribute("data-home-reveal");
    vi.stubGlobal("innerHeight", 600);
    fireEvent(window, new Event("resize"));
    expect(observers.every((item) => item.targets.size === 0)).toBe(true);
  });

  it("leaves normal visible content when intersection observation is unavailable", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<HomeMotion />);

    expect(screen.getByRole("heading", { name: "Services heading" })).not.toHaveAttribute("data-home-reveal");
    expect(screen.getByText("Service explanation")).not.toHaveAttribute("data-home-reveal");
  });

  it("disconnects observation and removes motion state and listeners on unmount", () => {
    const removeResize = vi.spyOn(window, "removeEventListener");
    const removeMotionChange = vi.spyOn(motion, "removeEventListener");
    const { unmount } = render(<HomeMotion />);
    const root = screen.getByTestId("motion-root");
    const removeRootListener = vi.spyOn(root, "removeEventListener");
    const explanation = screen.getByText("Service explanation");
    const observer = currentObserver();
    act(() => observer.notify(explanation));

    unmount();

    expect(observer.disconnect).toHaveBeenCalled();
    expect(observer.targets.size).toBe(0);
    expect(explanation).not.toHaveAttribute("data-home-reveal");
    expect(explanation.style.getPropertyValue("--home-entrance-delay")).toBe("");
    expect(removeRootListener).toHaveBeenCalledWith("focusin", expect.any(Function));
    expect(removeRootListener).toHaveBeenCalledWith("animationend", expect.any(Function));
    expect(removeMotionChange).toHaveBeenCalledWith("change", expect.any(Function));
    expect(removeResize).toHaveBeenCalledWith("resize", expect.any(Function));
  });
});
