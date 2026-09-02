import { act, fireEvent, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Button } from "./button";
import type { BlueButtonFluidRenderer } from "./blue-button-fluid-renderer";
import { installBlueButtonHover } from "./blue-button-hover-controller";

class Preference extends EventTarget {
  matches: boolean;
  constructor(matches: boolean) { super(); this.matches = matches; }
  change(matches: boolean) {
    this.matches = matches;
    this.dispatchEvent(new Event("change"));
  }
}

let motion: Preference;
let pointer: Preference;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let cleanup: () => void;
let renderer: { [K in keyof BlueButtonFluidRenderer]: ReturnType<typeof vi.fn<BlueButtonFluidRenderer[K]>> };
let factory: ReturnType<typeof vi.fn<(canvas: HTMLCanvasElement) => BlueButtonFluidRenderer | null>>;
let load: ReturnType<typeof vi.fn<() => Promise<{ createBlueButtonFluidRenderer: typeof factory }>>>;

function advance(now = performance.now()) {
  const current = [...frames.values()];
  frames.clear();
  current.forEach((callback) => callback(now));
}

function point(target: Element, type = "pointerover", options: { pointerType?: string; clientX?: number; clientY?: number; relatedTarget?: EventTarget } = {}) {
  const event = new MouseEvent(type, { bubbles: true, clientX: 140, clientY: 35, ...options });
  Object.defineProperty(event, "pointerType", { value: options.pointerType ?? "mouse" });
  fireEvent(target, event);
}

function blueButton() {
  render(<button className="bg-brand" style={{ backgroundColor: "#155eef" }}>Continue</button>);
  return screen.getByRole("button", { name: "Continue" });
}

async function ready() {
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  motion = new Preference(false);
  pointer = new Preference(true);
  frames = new Map();
  nextFrame = 0;
  renderer = { resize: vi.fn(), reset: vi.fn(), move: vi.fn(), render: vi.fn(), dispose: vi.fn() };
  factory = vi.fn<(canvas: HTMLCanvasElement) => BlueButtonFluidRenderer | null>(() => renderer);
  load = vi.fn(async () => ({ createBlueButtonFluidRenderer: factory }));
  vi.stubGlobal("matchMedia", vi.fn((query: string) => query.includes("reduced-motion") ? motion : pointer));
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => frames.delete(id)));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 20, y: 10, left: 20, top: 10, right: 180, bottom: 60, width: 160, height: 50, toJSON: () => ({}) });
  cleanup = installBlueButtonHover({ loadRenderer: load });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("blue action hover", () => {
  it("loads the simulation only on eligible pointer hover and leaves actions immediate", async () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(<form onSubmit={submit}><Button style={{ backgroundColor: "#155eef" }} type="submit">Continue</Button></form>);
    const button = screen.getByRole("button", { name: "Continue" });
    const originalChildren = [...button.childNodes];
    button.focus();
    expect(load).not.toHaveBeenCalled();
    point(button);
    expect(load).toHaveBeenCalledTimes(1);
    expect(button.querySelector("[data-blue-button-fluid]")).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(button);
    expect(submit).toHaveBeenCalledTimes(1);
    await ready();
    advance();
    expect(button.querySelector("[data-blue-button-fluid]")).toHaveAttribute("data-renderer", "webgl");
    expect(button.querySelectorAll("canvas")).toHaveLength(1);
    expect(renderer.resize).toHaveBeenCalledWith(160, 50, window.devicePixelRatio);
    expect(renderer.move).toHaveBeenLastCalledWith(.75, .5);
    expect(renderer.render).toHaveBeenCalledWith(1 / 60, true);
    expect(button.childNodes[0]).toBe(originalChildren[0]);
    expect(button).toHaveAccessibleName("Continue");
    expect(button).toHaveFocus();
  });

  it.each(["bg-brand", "bg-primary", "review-primary", "request-button-primary"])("covers existing %s actions including late-mounted portals", async (className) => {
    render(createPortal(<a href="#next" className={className} style={{ backgroundColor: "#155eef", position: "fixed" }}><span>Next</span></a>, document.body));
    const link = screen.getByRole("link", { name: "Next" });
    point(link.firstElementChild!);
    await ready();
    expect(link).toHaveAttribute("data-blue-button-hover", "active");
    expect(link).not.toHaveAttribute("data-blue-button-position");
    expect(link).toHaveAttribute("href", "#next");
    expect(link.querySelector("canvas")).toBeInTheDocument();
  });

  it("retains shared asChild anchor semantics", async () => {
    render(<Button asChild style={{ backgroundColor: "#155eef" }}><a href="#result">View result</a></Button>);
    const link = screen.getByRole("link", { name: "View result" });
    point(link);
    await ready();
    expect(link.tagName).toBe("A");
    expect(link.querySelectorAll("canvas")).toHaveLength(1);
    expect(link).toHaveAttribute("href", "#result");
  });

  it.each(["rgb(21, 94, 239)", "rgba(21, 94, 239, 0.8)", "color(srgb 0.082 0.369 0.937 / 0.8)"])("recognizes the computed blue fill %s", (backgroundColor) => {
    const button = blueButton();
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ backgroundColor, position: "static" } as CSSStyleDeclaration);
    point(button);
    expect(button).toHaveAttribute("data-blue-button-hover", "active");
  });

  it.each([true, false])("normalizes interrupted color transitions while retaining the blue-only guard (%s)", (isBlue) => {
    const button = blueButton();
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ backgroundColor: "oklab(0.527 -0.03 -0.22)", position: "static" } as CSSStyleDeclaration);
    const context = { fillStyle: "", fillRect: vi.fn(), getImageData: vi.fn(() => ({ data: isBlue ? [21, 94, 239, 255] : [255, 255, 255, 255] })) };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    point(button);
    expect(context.fillStyle).toBe("oklab(0.527 -0.03 -0.22)");
    expect(button.hasAttribute("data-blue-button-hover")).toBe(isBlue);
  });

  it("leaves neutral, transparent, disabled, busy, inert, and non-action elements alone", () => {
    render(<>
      <Button variant="outline">Outline</Button>
      <Button style={{ backgroundColor: "white" }}>Neutral override</Button>
      <button className="bg-brand" style={{ backgroundColor: "rgba(21,94,239,.2)" }}>Transparent</button>
      <button className="bg-brand" disabled style={{ backgroundColor: "#155eef" }}>Disabled</button>
      <button className="bg-brand" aria-disabled="true" style={{ backgroundColor: "#155eef" }}>Unavailable</button>
      <button className="bg-brand" aria-busy="true" style={{ backgroundColor: "#155eef" }}>Busy</button>
      <div inert><button className="bg-brand" style={{ backgroundColor: "#155eef" }}>Inert</button></div>
      <span className="bg-brand" style={{ backgroundColor: "#155eef" }}>Progress</span>
      <button role="switch" className="data-[state=checked]:bg-brand" style={{ backgroundColor: "#155eef" }}>Switch</button>
    </>);
    document.querySelectorAll("button, span.bg-brand").forEach((target) => point(target));
    expect(document.querySelector("[data-blue-button-fluid]")).toBeNull();
    expect(load).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it("uses a single canvas when the pointer moves between buttons", async () => {
    render(<><button className="bg-brand" style={{ backgroundColor: "#155eef" }}>First</button><button className="bg-brand" style={{ backgroundColor: "#155eef" }}>Second</button></>);
    const [first, second] = screen.getAllByRole("button");
    point(first);
    await ready();
    const canvas = first.querySelector("canvas");
    point(second, "pointermove", { clientX: 200, clientY: -20 });
    expect(first).not.toHaveAttribute("data-blue-button-hover");
    expect(second.querySelector("canvas")).toBe(canvas);
    expect(renderer.reset).toHaveBeenCalledOnce();
    expect(renderer.move).toHaveBeenLastCalledWith(1, 0);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("[data-blue-button-fluid]")).toHaveLength(1);
    expect(frames.size).toBe(1);
  });

  it("fades on leave, allows re-entry, and stops all frame work afterward", async () => {
    const button = blueButton();
    point(button);
    await ready();
    const left = performance.now();
    point(button, "pointerout");
    expect(button).toHaveAttribute("data-blue-button-hover", "leaving");
    advance(left + 200);
    expect(renderer.render).toHaveBeenLastCalledWith(1 / 60, false);
    point(button, "pointerover");
    expect(button).toHaveAttribute("data-blue-button-hover", "active");
    point(button, "pointerout");
    advance(performance.now() + 421);
    expect(button.querySelector("[data-blue-button-fluid]")).toBeNull();
    expect(button).not.toHaveAttribute("data-blue-button-position");
    expect(frames.size).toBe(0);
  });

  it.each([0, 200, 500])("resets before re-entry after %sms without reallocating the canvas", async (delay) => {
    const button = blueButton();
    point(button);
    await ready();
    advance();
    const canvas = button.querySelector("canvas");
    point(button, "pointermove", { clientX: 60 });
    expect(renderer.reset).not.toHaveBeenCalled();
    point(button, "pointerout");
    if (delay) advance(performance.now() + delay);
    point(button, "pointerover", { clientX: 172, clientY: 20 });
    expect(renderer.reset).toHaveBeenCalledOnce();
    expect(renderer.reset.mock.invocationCallOrder[0]).toBeLessThan(renderer.move.mock.invocationCallOrder.at(-1)!);
    expect(renderer.move).toHaveBeenLastCalledWith(.95, .2);
    expect(button.querySelector("canvas")).toBe(canvas);
    expect(button).toHaveAttribute("data-blue-button-hover", "active");
    expect(factory).toHaveBeenCalledOnce();
    advance();
    expect(renderer.render).toHaveBeenLastCalledWith(1 / 60, true);
    point(button, "pointermove", { clientX: 150 });
    expect(renderer.reset).toHaveBeenCalledOnce();
  });

  it("ignores movement between a button and its label", async () => {
    render(<button className="bg-brand" style={{ backgroundColor: "#155eef" }}><span>Next</span></button>);
    const button = screen.getByRole("button");
    point(button);
    await ready();
    point(button, "pointerout", { relatedTarget: button.firstElementChild! });
    point(button.firstElementChild!, "pointerover");
    expect(button).toHaveAttribute("data-blue-button-hover", "active");
    expect(renderer.reset).not.toHaveBeenCalled();
  });

  it.each(["disabled", "detached", "text replaced", "zero size", "unselected"])("stops when the target becomes %s", async (condition) => {
    const button = blueButton();
    point(button);
    await ready();
    if (condition === "disabled") button.setAttribute("disabled", "");
    if (condition === "detached") button.parentElement!.remove();
    if (condition === "text replaced") button.textContent = "Updated";
    if (condition === "unselected") button.classList.remove("bg-brand");
    if (condition === "zero size") vi.spyOn(button, "getBoundingClientRect").mockReturnValue(new DOMRect());
    advance();
    expect(button).not.toHaveAttribute("data-blue-button-hover");
    expect(frames.size).toBe(0);
  });

  it("survives a React label update without replacing the button or delaying its handler", async () => {
    const click = vi.fn();
    const view = render(<button className="bg-brand" style={{ backgroundColor: "#155eef" }} onClick={click}>Continue</button>);
    const button = screen.getByRole("button");
    point(button);
    await ready();
    view.rerender(<button className="bg-brand" style={{ backgroundColor: "#155eef" }} onClick={click}>Retry</button>);
    point(button, "pointermove");
    expect(screen.getByRole("button", { name: "Retry" })).toBe(button);
    expect(button.querySelectorAll("canvas")).toHaveLength(1);
    fireEvent.click(button);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it.each(["reduced motion", "coarse pointer", "touch"])("does not run the effect for %s", (preference) => {
    const button = blueButton();
    if (preference === "reduced motion") motion.change(true);
    if (preference === "coarse pointer") pointer.change(false);
    point(button, "pointerover", { pointerType: preference === "touch" ? "touch" : "mouse" });
    expect(load).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(button).not.toHaveAttribute("data-blue-button-hover");
  });

  it("releases resources when preferences change and supports re-enabling", async () => {
    const button = blueButton();
    point(button);
    await ready();
    motion.change(true);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    point(button);
    expect(factory).toHaveBeenCalledTimes(1);
    motion.change(false);
    point(button);
    await ready();
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it.each(["scroll", "blur", "pagehide", "visibilitychange"])("cleans up on %s", async (event) => {
    const button = blueButton();
    point(button);
    await ready();
    (event === "blur" || event === "pagehide" ? window : document).dispatchEvent(new Event(event));
    expect(frames.size).toBe(0);
    expect(button.querySelector("canvas")).toBeNull();
    if (event !== "scroll") expect(renderer.dispose).toHaveBeenCalledTimes(1);
  });

  it.each(["unavailable", "load error", "factory error", "render error", "reset error", "context lost"])("keeps an accessible fallback on renderer %s", async (failure) => {
    if (failure === "unavailable") factory.mockReturnValue(null);
    if (failure === "load error") load.mockRejectedValue(new Error("Unavailable"));
    if (failure === "factory error") factory.mockImplementation(() => { throw new Error("Unavailable"); });
    if (failure === "render error") renderer.render.mockImplementation(() => { throw new Error("Unavailable"); });
    if (failure === "reset error") renderer.reset.mockImplementation(() => { throw new Error("Unavailable"); });
    const button = blueButton();
    point(button);
    await ready();
    if (failure === "reset error") {
      point(button, "pointerout");
      point(button, "pointerover");
    }
    if (failure === "context lost") button.querySelector("canvas")!.dispatchEvent(new Event("webglcontextlost"));
    advance();
    expect(button.querySelector("[data-blue-button-fluid]")).toHaveAttribute("data-renderer", "fallback");
    expect(button.querySelector("canvas")).toBeNull();
    expect(button).toHaveAccessibleName("Continue");
    point(button, "pointermove");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("ignores a late import after unmount and removes delegated listeners", async () => {
    let resolve!: (value: { createBlueButtonFluidRenderer: typeof factory }) => void;
    load.mockReturnValue(new Promise((done) => { resolve = done; }));
    const button = blueButton();
    point(button);
    cleanup();
    resolve({ createBlueButtonFluidRenderer: factory });
    await ready();
    point(button);
    expect(factory).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    expect(button).not.toHaveAttribute("data-blue-button-hover");
  });
});
