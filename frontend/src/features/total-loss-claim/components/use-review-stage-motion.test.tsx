import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useReviewStageMotion } from "./use-review-stage-motion";

const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
const animate = vi.fn();
const scrollIntoView = vi.fn();

interface ControlledAnimation {
  readonly target: HTMLElement;
  readonly frames: Keyframe[];
  readonly options: KeyframeAnimationOptions;
  readonly cancel: ReturnType<typeof vi.fn>;
}

let animations: ControlledAnimation[];

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
          <summary>Supporting evidence</summary>
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
        <h1 data-review-entrance="primary">{stage}</h1>
        <div data-review-entrance="secondary">
          Evidence and values
          <span data-review-entrance="supporting">Nested evidence label</span>
          {includeRange ? <div className="value-range-axis" aria-hidden="true"><span className="value-range-band" /><span className="value-range-median" /><span className="value-range-offer" /></div> : null}
        </div>
        <p data-review-entrance="supporting">Supporting limitations</p>
        {includeExtra ? <p data-review-entrance="primary">Extra content</p> : null}
        <p data-review-entrance="unknown">Unselected content</p>
      </div>
      <nav className="review-actions" aria-label="Review actions">
        {includeActions ? <button data-review-entrance="supporting" type="button">Back</button> : null}
        <button data-review-entrance={includeActions ? "secondary" : undefined} onClick={onCommit} type="button">Continue</button>
      </nav>
    </section>
  );
}

function headingEntrance() {
  const animation = animations.findLast((item) => item.target.tagName === "H1");
  if (!animation) throw new Error("Expected a heading entrance");
  return animation;
}

function setMotionPreferences({ reduced = false, compact = false }: { readonly reduced?: boolean; readonly compact?: boolean } = {}) {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)" ? reduced : query === "(max-width: 540px)" ? compact : false,
  })));
}

beforeEach(() => {
  animations = [];
  animate.mockClear();
  scrollIntoView.mockClear();
  animate.mockImplementation(function (this: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
    const animation = { target: this, frames, options, cancel: vi.fn() };
    animations.push(animation);
    return animation;
  });
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
  setMotionPreferences();
});

afterEach(() => {
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, "animate", originalAnimate);
  else Reflect.deleteProperty(HTMLElement.prototype, "animate");
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  vi.unstubAllGlobals();
});

describe("completed review stage motion", () => {
  it("keeps the editor node, focus, selection, and motion unchanged through typing and saved-draft rerenders", async () => {
    const { rerender } = render(<Review includeDraftEntrance />);
    const root = screen.getByRole("region", { name: "Valuation review" });
    const editor = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Draft message" });
    expect(root).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledOnce();
    const initialEntrances = [...animations];
    expect(initialEntrances).toHaveLength(6);
    expect(initialEntrances.slice(0, 3).map((animation) => animation.target.dataset.reviewEntrance)).toEqual(["primary", "secondary", "supporting"]);
    expect(initialEntrances.filter((animation) => animation.target.contains(editor)).map((animation) => animation.target.className)).toEqual(["request-draft-column"]);

    await userEvent.setup().type(editor, " with supporting evidence");
    editor.setSelectionRange(3, 10, "backward");
    for (const draftStatus of ["Saving", "Conflict resolved", "Saved"]) rerender(<Review includeDraftEntrance savedRevision={2} draftStatus={draftStatus} />);

    expect(screen.getByRole("textbox", { name: "Draft message" })).toBe(editor);
    expect(editor).toHaveValue("My request with supporting evidence");
    expect(editor).toHaveFocus();
    expect([editor.selectionStart, editor.selectionEnd, editor.selectionDirection]).toEqual([3, 10, "backward"]);
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(animations).toEqual(initialEntrances);
    expect(animations.every((animation) => animation.cancel.mock.calls.length === 0)).toBe(true);
  });

  it("uses the same slower vertical entrance forward and back while the shell stays stationary", () => {
    const { rerender, unmount } = render(<Review stage="result" index={1} />);
    const firstEntrances = [...animations];
    rerender(<Review stage="insurer" index={2} />);
    const forward = headingEntrance();

    expect(forward.frames[0]).toEqual({ opacity: .62, filter: "blur(6px)", translate: "0 12px", offset: 0 });
    expect(forward.frames.at(-1)).toEqual({ opacity: 1, filter: "blur(0px)", translate: "0 0", offset: 1 });
    expect(forward.options).toEqual({ duration: 900, delay: 0, easing: "cubic-bezier(.22, .8, .24, 1)", fill: "backwards" });
    expect(firstEntrances.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);

    rerender(<Review stage="market" index={3} />);
    rerender(<Review stage="insurer" index={2} />);
    const backward = headingEntrance();
    expect(backward.frames).toEqual(forward.frames);
    expect(backward.options).toEqual(forward.options);
    expect(screen.getByRole("region", { name: "Valuation review" })).not.toHaveAttribute("data-direction");
    expect(scrollIntoView).toHaveBeenCalledTimes(4);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "start", inline: "nearest", behavior: "instant" });

    unmount();
    expect(animations.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);
  });

  it("animates only selected content groups and leaves the stage, editor, fields, progress, and ungrouped buttons untouched", () => {
    render(<Review />);
    expect(animations).toHaveLength(3);
    expect(animations.map((animation) => animation.target.dataset.reviewEntrance)).toEqual(["primary", "secondary", "supporting"]);
    expect(animations.map((animation) => animation.options.delay)).toEqual([0, 150, 300]);
    expect(animations.every((animation) => Number(animation.options.delay) + Number(animation.options.duration) <= 1200)).toBe(true);
    expect(animations.every((animation) => animation.frames.every((frame) => Number(frame.opacity) > 0 && frame.transform === undefined && frame.scale === undefined))).toBe(true);
    const stationary = [
      screen.getByRole("region", { name: "Valuation review" }),
      document.querySelector(".review-stage-content"),
      document.querySelector(".request-review"),
      document.querySelector(".request-composer"),
      screen.getByRole("textbox", { name: "Recipient" }),
      screen.getByRole("textbox", { name: "Draft message" }),
      screen.getByRole("status"),
      screen.getByText("Step 5"),
      screen.getByRole("button", { name: "Continue" }),
    ];
    expect(animations.every((animation) => stationary.every((node) => node && !animation.target.contains(node)))).toBe(true);
    expect(animations.some((animation) => animation.target.textContent === "Nested evidence label")).toBe(false);
    expect(animations.some((animation) => animation.target.textContent === "Unselected content")).toBe(false);
  });

  it("reveals content in reading order even when later content has a stronger emphasis", () => {
    render(<Review includeExtra />);

    expect(animations.map((animation) => animation.target.textContent)).toEqual([
      "request", "Evidence and valuesNested evidence label", "Supporting limitations", "Extra content",
    ]);
    expect(animations.map((animation) => animation.options.delay)).toEqual([0, 150, 300, 450]);
    expect(animations[3].target.dataset.reviewEntrance).toBe("primary");
    expect(animations.every((animation) => animation.frames[0].opacity !== 0)).toBe(true);
  });

  it("keeps offscreen groups softly blurred and reveals intersecting groups in document order", () => {
    let notify!: IntersectionObserverCallback;
    const observe = vi.fn();
    const unobserve = vi.fn();
    const disconnect = vi.fn();
    class ControlledIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) { notify = callback; }
      observe = observe;
      unobserve = unobserve;
      disconnect = disconnect;
    }
    vi.stubGlobal("IntersectionObserver", ControlledIntersectionObserver);

    const { unmount } = render(<Review />);
    const groups = Array.from(document.querySelectorAll<HTMLElement>("[data-review-entrance]"))
      .filter((target) => target.closest(".review-stage-content") === target.parentElement);
    const heading = screen.getByRole("heading", { name: "request" });
    const supporting = screen.getByText("Supporting limitations");

    expect(animations).toHaveLength(0);
    expect(observe).toHaveBeenCalledTimes(3);
    expect(heading).toHaveAttribute("data-review-reveal", "pending");
    expect(supporting).toHaveAttribute("data-review-reveal", "pending");

    const entry = (target: Element): IntersectionObserverEntry => ({
      target,
      isIntersecting: true,
      intersectionRatio: 1,
      boundingClientRect: target.getBoundingClientRect(),
      intersectionRect: target.getBoundingClientRect(),
      rootBounds: null,
      time: 0,
    });
    act(() => notify([
      entry(supporting),
      entry(heading),
    ], {} as IntersectionObserver));

    expect(animations.map((animation) => animation.target)).toEqual([heading, supporting]);
    expect(animations.map((animation) => animation.options.delay)).toEqual([0, 150]);
    expect(unobserve.mock.calls.map(([target]) => target)).toEqual([supporting, heading]);
    expect(heading).not.toHaveAttribute("data-review-reveal");
    expect(supporting).not.toHaveAttribute("data-review-reveal");
    expect(groups.filter((target) => target.dataset.reviewReveal === "pending")).toHaveLength(1);

    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(document.querySelector("[data-review-reveal='pending']")).not.toBeInTheDocument();
  });

  it("reveals the navigation buttons individually after the content in control order", () => {
    render(<Review stage="market" includeActions />);

    expect(animations).toHaveLength(5);
    const footer = screen.getByRole("navigation", { name: "Review actions" });
    const back = screen.getByRole("button", { name: "Back" });
    const continueButton = screen.getByRole("button", { name: "Continue" });
    expect(animations.some((animation) => animation.target === footer)).toBe(false);
    expect(animations.slice(-2).map((animation) => animation.target)).toEqual([back, continueButton]);
    expect(animations.slice(-2).map((animation) => animation.target.dataset.reviewEntrance)).toEqual(["supporting", "secondary"]);
    expect(animations.slice(-2).map((animation) => animation.options.delay)).toEqual([450, 600]);
    expect(animations.every((animation) => Number(animation.options.delay) + Number(animation.options.duration) <= 1500)).toBe(true);
  });

  it("keeps navigation buttons blurred until they enter the viewport, then reveals Back before Continue", () => {
    let notify!: IntersectionObserverCallback;
    const observe = vi.fn();
    const unobserve = vi.fn();
    class ControlledIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) { notify = callback; }
      observe = observe;
      unobserve = unobserve;
      disconnect = vi.fn();
    }
    vi.stubGlobal("IntersectionObserver", ControlledIntersectionObserver);

    render(<Review stage="market" includeActions />);
    const back = screen.getByRole("button", { name: "Back" });
    const continueButton = screen.getByRole("button", { name: "Continue" });
    expect(back).toHaveAttribute("data-review-reveal", "pending");
    expect(continueButton).toHaveAttribute("data-review-reveal", "pending");

    const entry = (target: Element): IntersectionObserverEntry => ({
      target,
      isIntersecting: true,
      intersectionRatio: 1,
      boundingClientRect: target.getBoundingClientRect(),
      intersectionRect: target.getBoundingClientRect(),
      rootBounds: null,
      time: 0,
    });
    act(() => notify([entry(continueButton), entry(back)], {} as IntersectionObserver));

    expect(animations.map((animation) => animation.target)).toEqual([back, continueButton]);
    expect(animations.map((animation) => animation.options.delay)).toEqual([0, 150]);
    expect(unobserve.mock.calls.map(([target]) => target)).toEqual([continueButton, back]);
    expect(back).not.toHaveAttribute("data-review-reveal");
    expect(continueButton).not.toHaveAttribute("data-review-reveal");
  });

  it("settles the result range axis together without extra blur or individual marker animation", () => {
    const { rerender, unmount } = render(<Review stage="result" includeRange />);
    const range = document.querySelector(".value-range-axis");
    const entrance = animations.find((animation) => animation.target === range)!;
    expect(entrance).toBeDefined();
    expect(entrance.frames).toEqual([{ opacity: .7, translate: "0 2px" }, { opacity: 1, translate: "0 0" }]);
    expect(entrance.options).toEqual({ duration: 420, delay: 430, easing: "cubic-bezier(.22, .8, .24, 1)", fill: "backwards" });
    expect(animations.some((animation) => animation.target.matches(".value-range-band, .value-range-median, .value-range-offer"))).toBe(false);
    const initialCount = animations.length;

    rerender(<Review stage="result" includeRange savedRevision={2} />);
    expect(animations).toHaveLength(initialCount);
    expect(entrance.cancel).not.toHaveBeenCalled();

    rerender(<Review stage="market" includeRange />);
    expect(entrance.cancel).toHaveBeenCalledOnce();
    expect(animations.filter((animation) => animation.target.className === "value-range-axis")).toHaveLength(1);

    unmount();
    expect(animations.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);
  });

  it("sustains blur through more of the entrance, then settles without ever making content invisible", () => {
    render(<Review stage="result" index={1} />);

    for (const animation of animations) {
      expect(animation.frames).toHaveLength(3);
      expect(animation.frames[1]).toEqual({ opacity: .96, filter: "blur(0px)", translate: "0 2px", offset: .78 });
      expect(animation.frames[2]).toEqual({ opacity: 1, filter: "blur(0px)", translate: "0 0", offset: 1 });
      expect(animation.frames.every((frame) => Number(frame.opacity) > 0 && String(frame.translate).split(" ")[0] === "0")).toBe(true);
    }
  });

  it.each([
    ["result", 8, 14, .55],
    ["meaning", 8, 14, .55],
    ["insurer", 6, 12, .62],
    ["market", 6, 12, .62],
    ["request", 6, 12, .62],
    ["waiting", 5, 10, .65],
  ] as const)("uses the intended primary emphasis for %s and a quieter supporting entrance", (stage, blur, travel, opacity) => {
    render(<Review stage={stage} />);

    expect(headingEntrance().frames[0]).toEqual({ opacity, filter: `blur(${blur}px)`, translate: `0 ${travel}px`, offset: 0 });
    expect(animations[1].frames[0]).toEqual({ opacity: .62, filter: "blur(6px)", translate: "0 12px", offset: 0 });
    expect(animations[2].frames[0]).toEqual({ opacity: .72, filter: "blur(4px)", translate: "0 8px", offset: 0 });
  });

  it.each([
    ["result", 4, 10],
    ["meaning", 4, 10],
    ["market", 3, 8],
    ["waiting", 3, 8],
  ] as const)("reduces blur and travel on compact layouts for %s", (stage, blur, travel) => {
    setMotionPreferences({ compact: true });
    render(<Review stage={stage} />);

    expect(headingEntrance().frames[0]).toMatchObject({ filter: `blur(${blur}px)`, translate: `0 ${travel}px` });
    expect(animations[1].frames[0]).toMatchObject({ filter: "blur(3px)", translate: "0 8px" });
    expect(animations[2].frames[0]).toMatchObject({ filter: "blur(3px)", translate: "0 8px" });
    expect(animations.every((animation) => animation.frames[1].filter === "blur(0px)")).toBe(true);
  });

  it("ignores accidental entrance markers on wrappers, progress, editor ancestors, and editor descendants", () => {
    render(<Review markStationary />);

    expect(animations).toHaveLength(3);
    expect(animations.map((animation) => animation.target.textContent)).toEqual(["request", "Evidence and valuesNested evidence label", "Supporting limitations"]);
    const editor = screen.getByRole("textbox", { name: "Draft message" });
    const progress = document.querySelector(".review-progress")!;
    expect(animations.every((animation) => !animation.target.contains(editor) && !animation.target.contains(progress))).toBe(true);
  });

  it("keeps the focused editor and selection when the prepare-to-send index changes", async () => {
    const { rerender } = render(<Review index={5} includeDraftEntrance />);
    const editor = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Draft message" });
    await userEvent.setup().type(editor, " retained");
    editor.setSelectionRange(3, 10, "backward");
    const initialCount = animations.length;

    rerender(<Review index={6} includeDraftEntrance />);

    expect(screen.getByRole("textbox", { name: "Draft message" })).toBe(editor);
    expect(editor).toHaveValue("My request retained");
    expect(editor).toHaveFocus();
    expect([editor.selectionStart, editor.selectionEnd, editor.selectionDirection]).toEqual([3, 10, "backward"]);
    expect(animations).toHaveLength(initialCount + 5);
    expect(animations.slice(initialCount).every((animation) => !animation.target.contains(editor))).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);

    rerender(<Review index={6} includeDraftEntrance savedRevision={2} />);
    expect(editor).toHaveFocus();
    expect([editor.selectionStart, editor.selectionEnd, editor.selectionDirection]).toEqual([3, 10, "backward"]);
    expect(animations).toHaveLength(initialCount + 5);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it.each(["Recipient", "Editable note"])("preserves focus in the retained %s on an index change", (label) => {
    const { rerender } = render(<Review index={5} />);
    const editor = screen.getByLabelText(label);
    editor.focus();

    rerender(<Review index={6} />);

    expect(screen.getByLabelText(label)).toBe(editor);
    expect(editor).toHaveFocus();
  });

  it("skips hidden groups inside a closed evidence disclosure", () => {
    render(<Review includeDisclosure />);
    expect(animations).toHaveLength(3);
    expect(animations.some((animation) => animation.target.textContent === "Closed evidence content")).toBe(false);
    expect(animations.map((animation) => animation.target.dataset.reviewEntrance)).toEqual(["primary", "secondary", "supporting"]);
  });

  it("only replays entrances for stage, index, or report changes", () => {
    const { rerender } = render(<Review />);
    const initial = [...animations];
    rerender(<Review savedRevision={2} onCommit={vi.fn()} includeExtra />);
    expect(animations).toEqual(initial);
    expect(scrollIntoView).toHaveBeenCalledOnce();

    rerender(<Review reportId="replacement-report" />);
    expect(animations).toHaveLength(6);
    expect(initial.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("respects reduced motion while rendering and navigation remain immediate", () => {
    setMotionPreferences({ reduced: true, compact: true });
    const commit = vi.fn();
    const { rerender } = render(<Review stage="result" index={1} onCommit={commit} includeRange includeActions />);
    rerender(<Review stage="insurer" index={2} onCommit={commit} includeRange includeActions />);

    expect(screen.getByRole("heading", { name: "insurer" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Valuation review" })).toHaveFocus();
    expect(screen.getByRole("region", { name: "Valuation review" })).not.toHaveAttribute("data-direction");
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(commit).toHaveBeenCalledOnce();
    expect(animate).not.toHaveBeenCalled();
  });

  it("never delays or locks navigation while entrances are unfinished", () => {
    const commit = vi.fn();
    render(<Review onCommit={commit} />);
    const initialCount = animations.length;
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(commit).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(commit).toHaveBeenCalledTimes(2);
    expect(animations).toHaveLength(initialCount);
    expect(screen.getByRole("heading", { name: "request" })).toBeVisible();
  });

  it("works when the browser animation API is unavailable", () => {
    Reflect.deleteProperty(HTMLElement.prototype, "animate");
    const commit = vi.fn();
    const { rerender } = render(<Review onCommit={commit} />);
    rerender(<Review stage="result" index={1} onCommit={commit} includeRange includeActions />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("heading", { name: "result" })).toBeVisible();
    expect(commit).toHaveBeenCalledOnce();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(animate).not.toHaveBeenCalled();
  });
});
