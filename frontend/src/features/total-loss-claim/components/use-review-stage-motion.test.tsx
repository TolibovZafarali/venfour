import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReviewStageMotion } from "./use-review-stage-motion";

const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
const scrollIntoView = vi.fn();
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
    this.callback([{target, isIntersecting, intersectionRatio, boundingClientRect: bounds, intersectionRect: bounds, rootBounds: null, time: 0}], this);
  }
}
function createMotionPreference() {
  return Object.assign(new EventTarget(), { matches: false, media: "(prefers-reduced-motion: reduce)" });
}
let observers: ControlledObserver[];
let motion: ReturnType<typeof createMotionPreference>;
function Review({
  stage = "request",
  index = 5,
  reportId = "published-report",
  savedRevision = 1,
  onCommit = () => undefined,
  includeDisclosure = false,
  includeExtra = false,
  includeActions = false,
  includeRange = false,
  includeDraftEntrance = false,
  markStationary = false,
  draftStatus = "Saved",
}: {
  readonly stage?: string;
  readonly index?: number;
  readonly reportId?: string;
  readonly savedRevision?: number;
  readonly onCommit?: () => void;
  readonly includeDisclosure?: boolean;
  readonly includeExtra?: boolean;
  readonly includeActions?: boolean;
  readonly includeRange?: boolean;
  readonly includeDraftEntrance?: boolean;
  readonly markStationary?: boolean;
  readonly draftStatus?: string;
}) {
  const root = useRef<HTMLElement>(null);
  const [draft, setDraft] = useState("My request");
  useReviewStageMotion({ root, stage, index, reportId });

  return (
    <section ref={root} aria-label="Valuation review" tabIndex={-1}>
      <div className="review-progress" data-review-entrance={markStationary ? "primary" : undefined}><span data-review-entrance={markStationary ? "secondary" : undefined}>Step {index}</span></div>
      <div className="review-stage-content" data-review-entrance={markStationary ? "primary" : undefined}>
        {includeDisclosure ? <details>
          <summary data-review-entrance="supporting">Supporting evidence</summary>
          <p data-review-entrance="supporting">Closed evidence content</p>
        </details> : null}
        <div data-review-entrance={markStationary ? "supporting" : undefined}>
          <section className="request-review" data-review-entrance={markStationary ? "primary" : undefined}>
            {includeDraftEntrance ? <>
              <header data-review-entrance="primary">Review and send your request</header>
              <aside data-review-entrance="secondary">Evidence to attach</aside>
            </> : null}
            <div className="request-draft-column" data-review-entrance={includeDraftEntrance ? "supporting" : undefined}>
              <div className="request-composer" data-review-entrance={markStationary ? "secondary" : undefined}>
                <label>Recipient<input data-review-entrance={markStationary ? "primary" : undefined} defaultValue="adjuster@example.com" /></label>
                <label>Draft message<textarea data-review-entrance={markStationary ? "supporting" : undefined} value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
                <div aria-label="Editable note" contentEditable suppressContentEditableWarning tabIndex={0}>Draft note</div>
                <p role="status" data-review-entrance={markStationary ? "supporting" : undefined}>{draftStatus} revision {savedRevision}</p>
              </div>
            </div>
          </section>
        </div>
        <h1 data-review-entrance="primary" data-review-order="0">{stage}</h1>
        <div data-review-entrance="secondary" data-review-order="1" data-testid="evidence">
          Evidence and values
          <span data-review-entrance="supporting">Nested evidence label</span>
          {includeRange ? <div className="value-range-axis" aria-hidden="true"><span className="value-range-band" /><span className="value-range-median" /><span className="value-range-offer" /></div> : null}
        </div>
        <p data-review-entrance="supporting" data-review-order="2">Supporting limitations</p>
        {includeExtra ? <p data-review-entrance="primary" data-review-order="3">Extra content</p> : null}
        <p data-review-entrance="unknown">Unselected content</p>
      </div>
      <nav className="review-actions" aria-label="Review actions">
        {includeActions ? <button data-review-entrance="supporting" data-review-order="0" type="button">Back</button> : null}
        <button data-review-entrance={includeActions ? "secondary" : undefined} data-review-order="1" onClick={onCommit} type="button">Continue</button>
      </nav>
    </section>
  );
}

function currentObserver() {
  const observer = observers.at(-1);
  if (!observer) throw new Error("Expected the review observer");
  return observer;
}
function finishAnimation(target: HTMLElement, name = "scroll-focus-enter") {
  const event = new Event("animationend", { bubbles: true });
  Object.defineProperty(event, "animationName", { value: name });
  fireEvent(target, event);
}
function bounds(top: number, height = 48) {
  return { x: 0, y: top, top, bottom: top + height, left: 0, right: 300, width: 300, height, toJSON: () => ({}) };
}
beforeEach(() => {
  observers = [];
  motion = createMotionPreference();
  scrollIntoView.mockClear();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
  vi.stubGlobal("IntersectionObserver", ControlledObserver);
  vi.stubGlobal("matchMedia", vi.fn(() => motion));
  vi.stubGlobal("innerHeight", 1000);
  vi.stubGlobal("scrollY", 0);
  vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(3000);
});
afterEach(() => {
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("completed review scroll entrances", () => {
  it("waits for the inset viewport boundary regardless of target height", () => {
    render(<Review />);
    const heading = screen.getByRole("heading", { name: "request" });
    const evidence = screen.getByTestId("evidence");
    const observer = currentObserver();
    expect(observer.rootMargin).toBe("0px 0px -160px 0px");
    expect(observer.thresholds).toEqual([0]);
    expect(heading).toHaveAttribute("data-scroll-reveal", "pending");
    act(() => observer.notify(evidence, false, 0));
    expect(evidence).toHaveAttribute("data-scroll-reveal", "pending");
    act(() => observer.notify(evidence, true, 0.001));
    expect(evidence).toHaveAttribute("data-scroll-reveal", "entering");
    expect(observer.targets.has(evidence)).toBe(false);
    expect(heading).toHaveAttribute("data-scroll-reveal", "pending");
  });
  it("keeps authored local order independent of callback batches and emphasis", () => {
    render(<Review includeExtra />);
    const ordered = [screen.getByRole("heading", { name: "request" }), screen.getByTestId("evidence"), screen.getByText("Supporting limitations"), screen.getByText("Extra content")];
    for (const index of [3, 1, 0, 2]) act(() => currentObserver().notify(ordered[index]));
    expect(ordered.map((target) => target.style.getPropertyValue("--scroll-entrance-delay"))).toEqual(["0ms", "80ms", "160ms", "240ms"]);
  });
  it("excludes wrappers, progress, composer fields, nested labels, and unmarked range markers", () => {
    render(<Review markStationary includeRange />);
    expect([...currentObserver().targets]).toEqual([screen.getByRole("heading", { name: "request" }), screen.getByTestId("evidence"), screen.getByText("Supporting limitations")]);
    for (const selector of [".review-stage-content", ".request-review", ".request-composer", ".review-progress", "input", "textarea", ".value-range-axis"]) expect(document.querySelector(selector)).not.toHaveAttribute("data-scroll-reveal");
    expect(screen.getByText("Nested evidence label")).not.toHaveAttribute("data-scroll-reveal");
    expect(screen.getByText("Unselected content")).not.toHaveAttribute("data-scroll-reveal");
  });
  it("preserves editor identity, focus, selection, and motion through typing and saved-state rerenders", async () => {
    const { rerender } = render(<Review includeDraftEntrance />);
    const editor = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Draft message" });
    const column = editor.closest(".request-draft-column")!;
    const observer = currentObserver();
    expect(screen.getByRole("region", { name: "Valuation review" })).toHaveFocus();
    expect(column).toHaveAttribute("data-scroll-reveal", "pending");
    await userEvent.setup().type(editor, " with supporting evidence");
    editor.setSelectionRange(3, 10, "backward");
    for (const draftStatus of ["Saving", "Conflict resolved", "Saved"]) rerender(<Review includeDraftEntrance savedRevision={2} draftStatus={draftStatus} />);
    expect(screen.getByRole("textbox", { name: "Draft message" })).toBe(editor);
    expect(editor).toHaveValue("My request with supporting evidence");
    expect(editor).toHaveFocus();
    expect([editor.selectionStart, editor.selectionEnd, editor.selectionDirection]).toEqual([3, 10, "backward"]);
    expect(column).not.toHaveAttribute("data-scroll-reveal");
    expect(observer.targets.has(column)).toBe(false);
    expect(observers).toEqual([observer]);
    expect(observer.disconnect).not.toHaveBeenCalled();
    expect(scrollIntoView).toHaveBeenCalledOnce();
  });
  it.each(["Draft message", "Recipient", "Editable note"])("retains the focused %s when the prepare-to-send index changes", (label) => {
    const { rerender } = render(<Review index={5} includeDraftEntrance />);
    const editor = screen.getByLabelText(label);
    act(() => editor.focus());
    if (editor instanceof HTMLTextAreaElement) editor.setSelectionRange(3, 8, "backward");
    const previous = currentObserver();
    rerender(<Review index={6} includeDraftEntrance />);
    expect(screen.getByLabelText(label)).toBe(editor);
    expect(editor).toHaveFocus();
    if (editor instanceof HTMLTextAreaElement) expect([editor.selectionStart, editor.selectionEnd, editor.selectionDirection]).toEqual([3, 8, "backward"]);
    expect(previous.disconnect).toHaveBeenCalled();
    expect([...currentObserver().targets].every((target) => !target.contains(editor))).toBe(true);
    expect(editor.closest(".request-draft-column")).not.toHaveAttribute("data-scroll-reveal");
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    rerender(<Review index={6} includeDraftEntrance savedRevision={2} />);
    expect(observers).toHaveLength(2);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });
  it("resets immediately forward and back while retaining the frame and replays only for stage, index, or report changes", () => {
    const { rerender } = render(<Review stage="result" index={1} />);
    const root = screen.getByRole("region", { name: "Valuation review" });
    const frame = root.querySelector(".review-stage-content");
    const first = currentObserver();
    rerender(<Review stage="result" index={1} savedRevision={2} />);
    expect(observers).toEqual([first]);
    for (const [stage, index] of [["insurer", 2], ["market", 3], ["insurer", 2]] as const) {
      rerender(<Review stage={stage} index={index} />);
      expect(screen.getByRole("region", { name: "Valuation review" })).toBe(root);
      expect(root.querySelector(".review-stage-content")).toBe(frame);
      expect(root).toHaveFocus();
      expect(screen.getByRole("heading", { name: stage })).toHaveAttribute("data-scroll-reveal", "pending");
    }
    expect(first.disconnect).toHaveBeenCalled();
    rerender(<Review stage="insurer" index={2} reportId="replacement-report" />);
    expect(observers).toHaveLength(5);
    expect(scrollIntoView).toHaveBeenCalledTimes(5);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "start", inline: "nearest", behavior: "instant" });
  });
  it("skips closed disclosure content while allowing its summary to reveal on focus", () => {
    render(<Review includeDisclosure />);
    const summary = screen.getByText("Supporting evidence");
    const content = screen.getByText("Closed evidence content");
    expect(currentObserver().targets.has(summary)).toBe(true);
    expect(currentObserver().targets.has(content)).toBe(false);
    expect(content).not.toHaveAttribute("data-scroll-reveal");
    act(() => summary.focus());
    expect(summary).not.toHaveAttribute("data-scroll-reveal");
    expect(screen.getByTestId("evidence")).toHaveAttribute("data-scroll-reveal", "pending");
  });
  it("reveals controls independently without delaying navigation or nearby content", () => {
    const commit = vi.fn();
    render(<Review includeActions onCommit={commit} />);
    const back = screen.getByRole("button", { name: "Back" });
    const next = screen.getByRole("button", { name: "Continue" });
    act(() => currentObserver().notify(next));
    act(() => currentObserver().notify(back));
    expect(back.style.getPropertyValue("--scroll-entrance-delay")).toBe("0ms");
    expect(next.style.getPropertyValue("--scroll-entrance-delay")).toBe("80ms");
    act(() => next.focus());
    expect(next).not.toHaveAttribute("data-scroll-reveal");
    expect(next.style.getPropertyValue("--scroll-entrance-delay")).toBe("");
    expect(screen.getByTestId("evidence")).toHaveAttribute("data-scroll-reveal", "pending");
    fireEvent.click(next);
    expect(commit).toHaveBeenCalledOnce();
    expect(next).not.toBeDisabled();
  });
  it("reveals a final control at the document end even if it cannot reach the inset boundary", () => {
    render(<Review includeActions />);
    const next = screen.getByRole("button", { name: "Continue" });
    vi.spyOn(next, "getBoundingClientRect").mockReturnValue(bounds(900));
    vi.stubGlobal("scrollY", 1900);
    fireEvent.scroll(window);
    expect(next).toHaveAttribute("data-scroll-reveal", "pending");
    vi.stubGlobal("scrollY", 2000);
    fireEvent.scroll(window);
    expect(next).toHaveAttribute("data-scroll-reveal", "entering");
    expect(next).not.toHaveFocus();
  });
  it("reveals visible final content immediately when the entire stage fits without scrolling", () => {
    vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(1000);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return this.textContent === "Continue" ? bounds(900) : bounds(1100); });
    render(<Review includeActions />);
    expect(screen.getByRole("button", { name: "Continue" })).toHaveAttribute("data-scroll-reveal", "entering");
    expect(screen.getByTestId("evidence")).toHaveAttribute("data-scroll-reveal", "pending");
  });
  it("settles only the focus entrance and does not replay it", () => {
    render(<Review />);
    const evidence = screen.getByTestId("evidence");
    act(() => currentObserver().notify(evidence));
    finishAnimation(evidence, "scroll-opacity-enter");
    expect(evidence).toHaveAttribute("data-scroll-reveal", "entering");
    finishAnimation(evidence);
    expect(evidence).not.toHaveAttribute("data-scroll-reveal");
    expect(evidence.style.getPropertyValue("--scroll-entrance-delay")).toBe("");
    act(() => currentObserver().notify(evidence));
    expect(evidence).not.toHaveAttribute("data-scroll-reveal");
  });
  it("updates the viewport boundary on resize without replaying or resetting scroll", () => {
    render(<Review />);
    const heading = screen.getByRole("heading", { name: "request" });
    const observer = currentObserver();
    act(() => observer.notify(heading));
    vi.stubGlobal("innerHeight", 600);
    fireEvent(window, new Event("resize"));
    expect(observer.disconnect).toHaveBeenCalled();
    expect(currentObserver().rootMargin).toBe("0px 0px -96px 0px");
    expect(currentObserver().targets.has(heading)).toBe(false);
    expect(currentObserver().targets.has(screen.getByTestId("evidence"))).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledOnce();
  });
  it("honors initial and live reduced motion while focus and navigation remain immediate", () => {
    motion.matches = true;
    const commit = vi.fn();
    const view = render(<Review includeActions onCommit={commit} />);
    expect(screen.getByRole("region", { name: "Valuation review" })).toHaveFocus();
    expect(screen.getByRole("heading", { name: "request" })).not.toHaveAttribute("data-scroll-reveal");
    expect(observers).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(commit).toHaveBeenCalledOnce();
    view.unmount();
    motion.matches = false;
    render(<Review />);
    const heading = screen.getByRole("heading", { name: "request" });
    const observer = currentObserver();
    act(() => observer.notify(heading));
    act(() => { motion.matches = true; motion.dispatchEvent(new Event("change")); });
    expect(observer.disconnect).toHaveBeenCalled();
    expect(document.querySelector("[data-scroll-reveal]")).not.toBeInTheDocument();
  });
  it("leaves content usable without intersection observation", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const commit = vi.fn();
    render(<Review includeActions onCommit={commit} />);
    expect(screen.getByRole("heading", { name: "request" })).not.toHaveAttribute("data-scroll-reveal");
    expect(screen.getByRole("region", { name: "Valuation review" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(commit).toHaveBeenCalledOnce();
  });
  it("cleans pending and active state and listeners on unmount", () => {
    const removeWindow = vi.spyOn(window, "removeEventListener");
    const removeMotion = vi.spyOn(motion, "removeEventListener");
    const { unmount } = render(<Review />);
    const root = screen.getByRole("region", { name: "Valuation review" });
    const removeRoot = vi.spyOn(root, "removeEventListener");
    const evidence = screen.getByTestId("evidence");
    const observer = currentObserver();
    act(() => observer.notify(evidence));
    unmount();
    expect(observer.disconnect).toHaveBeenCalled();
    expect(evidence).not.toHaveAttribute("data-scroll-reveal");
    expect(evidence.style.getPropertyValue("--scroll-entrance-delay")).toBe("");
    expect(removeRoot).toHaveBeenCalledWith("focusin", expect.any(Function));
    expect(removeRoot).toHaveBeenCalledWith("animationend", expect.any(Function));
    expect(removeMotion).toHaveBeenCalledWith("change", expect.any(Function));
    expect(removeWindow).toHaveBeenCalledWith("resize", expect.any(Function));
  });
});
