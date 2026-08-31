import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState, type CSSProperties } from "react";
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
  readonly finish: () => void;
  readonly finished: Promise<void>;
}

let animations: ControlledAnimation[];

function Review({
  stage = "request",
  index = 5,
  reportId = "published-report",
  savedRevision = 1,
  onCommit = () => undefined,
  includeDisclosure = false,
}: {
  readonly stage?: string;
  readonly index?: number;
  readonly reportId?: string;
  readonly savedRevision?: number;
  readonly onCommit?: () => void;
  readonly includeDisclosure?: boolean;
}) {
  const root = useRef<HTMLElement>(null);
  const [draft, setDraft] = useState("My request");
  const motion = useReviewStageMotion({ root, stage, index, reportId });

  return (
    <section ref={root} aria-label="Valuation review" tabIndex={-1}>
      <span data-review-count>Step {index}</span>
      <div className="review-stage-content">
        <h1 data-review-reveal="heading" style={{ "--review-travel": "10", "--review-delay": "20" } as CSSProperties}>{stage}</h1>
        <div data-review-reveal="composer" style={{ "--review-travel": "4", "--review-delay": "80" } as CSSProperties}>
          <label>
            Draft message
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} />
          </label>
          <p role="status">Saved revision {savedRevision}</p>
        </div>
        {includeDisclosure ? <details data-review-reveal="disclosure">
          <summary data-review-reveal="summary">Supporting evidence</summary>
          <p data-review-reveal="detail">Closed evidence content</p>
        </details> : null}
      </div>
      <button onClick={() => motion.transitionTo(onCommit)} type="button">Continue</button>
    </section>
  );
}

function headingEntrance() {
  const animation = animations.findLast((item) => item.target.tagName === "H1");
  if (!animation) throw new Error("Expected a heading entrance");
  return animation;
}

function outgoingAnimation() {
  const animation = animations.findLast((item) => item.target.classList.contains("review-stage-content"));
  if (!animation) throw new Error("Expected an outgoing content animation");
  return animation;
}

function verticalTravel(animation: ControlledAnimation) {
  const [horizontal, vertical] = String(animation.frames[0].translate).split(" ").map(Number.parseFloat);
  expect(horizontal).toBe(0);
  expect(animation.frames.at(-1)?.translate).toBe("0 0");
  expect(animation.frames.every((frame) => frame.transform === undefined)).toBe(true);
  return vertical;
}

beforeEach(() => {
  animations = [];
  animate.mockImplementation(function (this: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
    let finish!: () => void;
    let reject!: (reason: DOMException) => void;
    const finished = new Promise<void>((resolve, rejectFinished) => {
      finish = resolve;
      reject = rejectFinished;
    });
    // Entrance cancellations do not have a finished-promise consumer in the hook.
    void finished.catch(() => undefined);
    const animation = {
      target: this, frames, options, finished, finish,
      cancel: vi.fn(() => reject(new DOMException("Animation cancelled", "AbortError"))),
    };
    animations.push(animation);
    return animation;
  });
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }));
});

afterEach(() => {
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, "animate", originalAnimate);
  else Reflect.deleteProperty(HTMLElement.prototype, "animate");
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  vi.unstubAllGlobals();
});

describe("completed review stage motion", () => {
  it("keeps the editor node, focus, and selection through typing and saved-draft rerenders", async () => {
    const { rerender } = render(<Review />);
    const root = screen.getByRole("region", { name: "Valuation review" });
    const editor = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Draft message" });
    expect(root).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledOnce();
    const entranceCount = animations.length;
    expect(entranceCount).toBeGreaterThan(0);

    await userEvent.setup().type(editor, " with supporting evidence");
    editor.setSelectionRange(3, 10, "backward");
    rerender(<Review savedRevision={2} />);

    expect(screen.getByRole("textbox", { name: "Draft message" })).toBe(editor);
    expect(editor).toHaveValue("My request with supporting evidence");
    expect(editor).toHaveFocus();
    expect([editor.selectionStart, editor.selectionEnd, editor.selectionDirection]).toEqual([3, 10, "backward"]);
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(animations).toHaveLength(entranceCount);
    expect(animations.every((animation) => animation.cancel.mock.calls.length === 0)).toBe(true);
  });

  it("choreographs individual entrances vertically while the frame stays still", () => {
    const { rerender, unmount } = render(<Review stage="result" index={1} />);
    const firstEntrances = [...animations];
    rerender(<Review stage="insurer" index={2} />);
    const forward = headingEntrance();

    expect(verticalTravel(forward)).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: "Valuation review" })).toHaveAttribute("data-direction", "forward");
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "start", inline: "nearest", behavior: "instant" });
    expect(firstEntrances.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);

    const composer = animations.findLast((animation) => animation.target.dataset.reviewReveal === "composer")!;
    expect(Number(composer.options.delay)).toBeGreaterThan(Number(forward.options.delay));
    expect(animations.every((animation) => animation.target !== screen.getByRole("region", { name: "Valuation review" }) && !animation.target.classList.contains("review-stage-content"))).toBe(true);

    rerender(<Review stage="result" index={1} />);
    const backward = headingEntrance();
    expect(verticalTravel(backward)).toBeLessThan(0);
    expect(Math.abs(verticalTravel(backward))).toBeLessThan(verticalTravel(forward));
    expect(Number(backward.options.delay)).toBeLessThan(Number(forward.options.delay));
    expect(screen.getByRole("region", { name: "Valuation review" })).toHaveAttribute("data-direction", "backward");
    expect(scrollIntoView).toHaveBeenCalledTimes(3);

    unmount();
    expect(animations.every((animation) => animation.cancel.mock.calls.length === 1)).toBe(true);
  });

  it("animates the prepare-to-send index change without replacing the draft editor", async () => {
    const { rerender } = render(<Review index={5} />);
    const editor = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Draft message" });
    await userEvent.setup().type(editor, " retained");
    const initialCount = animations.length;

    rerender(<Review index={6} />);

    expect(screen.getByRole("textbox", { name: "Draft message" })).toBe(editor);
    expect(editor).toHaveValue("My request retained");
    expect(screen.getByRole("region", { name: "Valuation review" })).toHaveFocus();
    expect(animations.length).toBeGreaterThan(initialCount);
    expect(verticalTravel(headingEntrance())).toBeGreaterThan(0);

    await userEvent.setup().click(editor);
    editor.setSelectionRange(5, 5);
    const entranceCount = animations.length;
    rerender(<Review index={6} savedRevision={2} />);
    expect(editor).toHaveFocus();
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([5, 5]);
    expect(animations).toHaveLength(entranceCount);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("does not animate content inside a closed evidence disclosure", () => {
    render(<Review includeDisclosure />);
    const roles = animations.map((animation) => animation.target.dataset.reviewReveal);
    expect(roles).toContain("disclosure");
    expect(roles).toContain("summary");
    expect(roles).not.toContain("detail");
  });

  it("respects reduced motion for entrances and outgoing navigation", () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    const commit = vi.fn();
    const { rerender } = render(<Review stage="result" index={1} onCommit={commit} />);
    rerender(<Review stage="insurer" index={2} onCommit={commit} />);

    expect(screen.getByRole("heading", { name: "insurer" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Valuation review" })).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(commit).toHaveBeenCalledOnce();
    expect(animate).not.toHaveBeenCalled();
  });

  it("commits immediately when browser animation is unavailable", () => {
    Reflect.deleteProperty(HTMLElement.prototype, "animate");
    const commit = vi.fn();
    render(<Review onCommit={commit} />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(commit).toHaveBeenCalledOnce();
    expect(animate).not.toHaveBeenCalled();
  });

  it("waits for the outgoing fade and deduplicates clicks only while it is unfinished", async () => {
    const commit = vi.fn();
    render(<Review stage="result" index={1} onCommit={commit} />);
    const button = screen.getByRole("button", { name: "Continue" });
    fireEvent.click(button);
    fireEvent.click(button);
    const exit = outgoingAnimation();

    expect(animations.filter((animation) => animation.target === exit.target)).toHaveLength(1);
    expect(commit).not.toHaveBeenCalled();
    expect(exit.frames).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    await act(async () => exit.finish());
    expect(commit).toHaveBeenCalledOnce();
    expect(exit.cancel).toHaveBeenCalledOnce();

    fireEvent.click(button);
    expect(commit).toHaveBeenCalledOnce();
    fireEvent.click(button);
    const nextExit = outgoingAnimation();
    expect(nextExit).not.toBe(exit);
    expect(animations.filter((animation) => animation.target === exit.target)).toHaveLength(2);
    await act(async () => nextExit.finish());
    expect(commit).toHaveBeenCalledTimes(2);
    expect(nextExit.cancel).toHaveBeenCalledOnce();
  });

  it("restores the content and releases navigation after a guarded destination does nothing", async () => {
    const navigate = vi.fn();
    let destinationAllowed = true;
    const commit = vi.fn(() => {
      if (destinationAllowed) navigate();
    });
    const { rerender } = render(<Review onCommit={commit} />);
    const button = screen.getByRole("button", { name: "Continue" });
    fireEvent.click(button);
    const staleExit = outgoingAnimation();

    destinationAllowed = false;
    rerender(<Review savedRevision={2} onCommit={commit} />);
    await act(async () => staleExit.finish());

    expect(commit).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    expect(staleExit.cancel).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "request" })).toBeVisible();

    destinationAllowed = true;
    fireEvent.click(button);
    const freshExit = outgoingAnimation();
    expect(freshExit).not.toBe(staleExit);
    await act(async () => freshExit.finish());

    expect(navigate).toHaveBeenCalledOnce();
    expect(freshExit.cancel).toHaveBeenCalledOnce();
  });

  it.each(["stage", "report", "unmount"] as const)("cancels an outgoing destination on %s changes", async (change) => {
    const commit = vi.fn();
    const { rerender, unmount } = render(<Review stage="meaning" index={4} onCommit={commit} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const exit = outgoingAnimation();

    if (change === "unmount") unmount();
    else if (change === "stage") rerender(<Review stage="market" index={3} onCommit={commit} />);
    else rerender(<Review stage="meaning" index={4} reportId="replacement-report" onCommit={commit} />);

    expect(exit.cancel).toHaveBeenCalledOnce();
    await act(async () => exit.finish());
    expect(commit).not.toHaveBeenCalled();
  });

  it("ignores an already-finished exit when unmounted before its callback runs", async () => {
    const commit = vi.fn();
    const { unmount } = render(<Review onCommit={commit} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const exit = outgoingAnimation();

    act(() => {
      exit.finish();
      unmount();
    });
    await act(async () => undefined);

    expect(commit).not.toHaveBeenCalled();
  });
});
