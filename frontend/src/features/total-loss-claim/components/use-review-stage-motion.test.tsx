import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import type * as ReactRouter from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useReviewStageMotion } from "./use-review-stage-motion";

const transition = vi.hoisted(() => ({ active: false }));

vi.mock("react-router", async (importOriginal) => ({
  ...await importOriginal<typeof ReactRouter>(),
  useViewTransitionState: () => transition.active,
}));

const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
const animate = vi.fn();
const cancelAnimation = vi.fn();
const scrollIntoView = vi.fn();

function Review({
  stage = "request",
  index = 5,
  locationKey = "request-location",
  savedRevision = 1,
}: {
  readonly stage?: string;
  readonly index?: number;
  readonly locationKey?: string;
  readonly savedRevision?: number;
}) {
  const root = useRef<HTMLElement>(null);
  const [draft, setDraft] = useState("My request");
  useReviewStageMotion({
    root,
    stage,
    index,
    locationKey,
    pathname: `/review/${stage}`,
    reportId: "published-report",
  });

  return (
    <section ref={root} aria-label="Valuation review" tabIndex={-1}>
      <div className="review-stage-content">
        <h1>{stage}</h1>
        <label>
          Draft message
          <input value={draft} onChange={(event) => setDraft(event.target.value)} />
        </label>
        <p role="status">Saved revision {savedRevision}</p>
      </div>
    </section>
  );
}

function startTranslation(call: number) {
  const frames = animate.mock.calls[call][0] as Keyframe[];
  return Number(String(frames[0].transform).match(/translateX\(([-.\d]+)px\)/u)?.[1]);
}

beforeEach(() => {
  transition.active = false;
  animate.mockImplementation(() => ({ cancel: cancelAnimation }));
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
  it("keeps the editor mounted and focused through typing and saved-draft rerenders", async () => {
    const { rerender } = render(<Review />);
    const root = screen.getByRole("region", { name: "Valuation review" });
    const editor = screen.getByRole("textbox", { name: "Draft message" });
    expect(root).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(animate).not.toHaveBeenCalled();

    await userEvent.setup().type(editor, " with supporting evidence");
    rerender(<Review savedRevision={2} />);

    expect(screen.getByRole("textbox", { name: "Draft message" })).toBe(editor);
    expect(editor).toHaveValue("My request with supporting evidence");
    expect(editor).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(animate).not.toHaveBeenCalled();
  });

  it("moves new stage content in opposite directions for forward and Back navigation", () => {
    const { rerender, unmount } = render(<Review stage="result" index={1} locationKey="result-one" />);
    rerender(<Review stage="insurer" index={2} locationKey="insurer-one" />);

    expect(screen.getByRole("region", { name: "Valuation review" })).toHaveFocus();
    expect(animate).toHaveBeenCalledOnce();
    expect(startTranslation(0)).toBeGreaterThan(0);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "start", behavior: "instant" });

    rerender(<Review stage="result" index={1} locationKey="result-two" />);

    expect(animate).toHaveBeenCalledTimes(2);
    expect(startTranslation(1)).toBeLessThan(0);
    expect(cancelAnimation).toHaveBeenCalledOnce();
    expect(scrollIntoView).toHaveBeenCalledTimes(3);

    unmount();
    expect(cancelAnimation).toHaveBeenCalledTimes(2);
  });

  it("animates prepare-to-send within one route without replacing the draft editor", async () => {
    const { rerender } = render(<Review index={5} />);
    const editor = screen.getByRole("textbox", { name: "Draft message" });
    await userEvent.setup().type(editor, " retained");

    rerender(<Review index={6} />);

    expect(screen.getByRole("textbox", { name: "Draft message" })).toBe(editor);
    expect(editor).toHaveValue("My request retained");
    expect(screen.getByRole("region", { name: "Valuation review" })).toHaveFocus();
    expect(animate).toHaveBeenCalledOnce();
    expect(startTranslation(0)).toBeGreaterThan(0);

    await userEvent.setup().click(editor);
    rerender(<Review index={6} savedRevision={2} />);
    expect(editor).toHaveFocus();
    expect(animate).toHaveBeenCalledOnce();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("respects reduced motion while still focusing and positioning the destination stage", () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    const { rerender } = render(<Review stage="result" index={1} locationKey="result" />);

    rerender(<Review stage="insurer" index={2} locationKey="insurer" />);

    expect(screen.getByRole("heading", { name: "insurer" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Valuation review" })).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(animate).not.toHaveBeenCalled();
  });

  it("does not double-animate a native transition or refocus the editor when it finishes", async () => {
    const { rerender } = render(<Review stage="meaning" index={4} locationKey="meaning" />);
    transition.active = true;
    rerender(<Review stage="request" index={5} locationKey="request" />);
    const editor = screen.getByRole("textbox", { name: "Draft message" });
    expect(screen.getByRole("region", { name: "Valuation review" })).toHaveFocus();
    expect(animate).not.toHaveBeenCalled();

    await userEvent.setup().type(editor, " after navigation");
    transition.active = false;
    rerender(<Review stage="request" index={5} locationKey="request" savedRevision={2} />);

    expect(screen.getByRole("textbox", { name: "Draft message" })).toBe(editor);
    expect(editor).toHaveValue("My request after navigation");
    expect(editor).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(animate).not.toHaveBeenCalled();
  });
});
