import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FreeValuationProcessing,
  FreeValuationProcessingProvider,
  InlineValuationProcessingBoundary,
} from "./free-valuation-processing";
import type { FreeValuationProcessingOptions } from "./free-valuation-processing-context";

vi.mock("./valuation-signal-field", () => ({
  ValuationSignalField: () => <canvas aria-hidden="true" data-testid="valuation-signals" />,
}));

function Harness({
  registration,
  registrationKey = "intake",
}: {
  registration?: FreeValuationProcessingOptions;
  registrationKey?: string;
}) {
  return (
    <FreeValuationProcessingProvider>
      <header><nav aria-label="Main navigation"><a href="/about">About Venfour</a></nav></header>
      <main id="main-content" tabIndex={-1}>
        <button type="button">Review and analyze</button>
        {registration ? <FreeValuationProcessing key={registrationKey} {...registration} /> : <h1>Your valuation result</h1>}
      </main>
      <footer><a href="/privacy">Privacy policy</a></footer>
    </FreeValuationProcessingProvider>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("free valuation processing environment", () => {
  it.each([false, true])("shows full-screen report processing over a case workspace and releases the result (reduced motion: %s)", async (reduced) => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: reduced })));
    const view = (processing: boolean) => <FreeValuationProcessingProvider inline>
      <main id="main-content" tabIndex={-1}>
        {processing ? <FreeValuationProcessing fullScreen phase="preparing" heading="Preparing your report" /> : <h1>Your completed report</h1>}
      </main>
    </FreeValuationProcessingProvider>;
    const rendered = render(view(true));
    const stars = screen.getByTestId("valuation-signals");
    expect(screen.getByRole("heading", { name: "Preparing your report" })).toBeVisible();
    expect(document.getElementById("main-content")?.closest("[inert]")).not.toBeNull();
    rendered.rerender(view(false));
    expect(screen.getByRole("heading", { name: "Your completed report" })).toBeVisible();
    expect(screen.getByTestId("valuation-signals")).toBe(stars);
    expect(document.querySelector("[data-free-valuation-processing]")).toHaveAttribute("data-exiting", "true");
    await act(async () => vi.advanceTimersByTimeAsync(reduced ? 10 : 1900));
    expect(screen.queryByTestId("valuation-signals")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it.each([false, true])("uses stars over the case workspace while preserving saved input and account access (reduced motion: %s)", (reduced) => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: reduced })));
    const openAccount = vi.fn();
    const view = (processing: boolean) => <FreeValuationProcessingProvider inline accountControl={<button onClick={openAccount}>Open account</button>}>
      <header><button onClick={openAccount}>Appraisal account</button></header>
      <main><InlineValuationProcessingBoundary><input aria-label="Saved input" defaultValue="Authored detail" />{processing ? <FreeValuationProcessing phase="reviewing" reviewKey="saved-case" /> : <h1>Saved result</h1>}</InlineValuationProcessingBoundary></main>
      <footer>Terms and privacy</footer>
    </FreeValuationProcessingProvider>;
    const rendered = render(view(true));
    const account = screen.getByText("Appraisal account");
    const main = screen.getByLabelText("Saved input").closest("main");
    const savedInput = screen.getByLabelText("Saved input");
    expect(savedInput).not.toBeVisible();
    expect(screen.getByTestId("valuation-signals")).toBeVisible();
    expect(document.querySelector(".workspace-processing__line")).not.toBeInTheDocument();
    expect(account.closest("[inert]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open account" }));
    expect(openAccount).toHaveBeenCalledOnce();
    rendered.rerender(view(false));
    expect(screen.getByRole("main")).toBe(main);
    expect(screen.getByRole("button", { name: "Appraisal account" })).toBe(account);
    expect(screen.getByRole("heading", { name: "Saved result" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Saved input" })).toBe(savedInput);
    expect(savedInput).toHaveValue("Authored detail");
  });
  it("keeps account switching interactive while the underlying workspace is hidden", () => {
    const openAccount = vi.fn();
    render(<FreeValuationProcessingProvider accountControl={<button onClick={openAccount}>Open account</button>}>
      <main><button>Underlying action</button><FreeValuationProcessing phase="reviewing" /></main>
    </FreeValuationProcessingProvider>);
    const account = screen.getByRole("button", { name: "Open account" });
    expect(account).toBeVisible();
    fireEvent.click(account);
    expect(openAccount).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Underlying action" })).not.toBeInTheDocument();
  });
  it("keeps the same signal field through an intake-to-analysis handoff", async () => {
    const rendered = render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Review and analyze" });
    trigger.focus();

    rendered.rerender(<Harness registration={{ phase: "preparing", reviewKey: "saved-case", vehicle: "2020 Toyota Camry SE" }} />);

    const signals = screen.getByTestId("valuation-signals");
    expect(screen.getByRole("heading", { name: "Preparing your valuation" })).toBeVisible();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review and analyze" })).not.toBeInTheDocument();
    expect(document.activeElement).toContainElement(signals);

    rendered.rerender(<Harness registrationKey="analysis" registration={{ phase: "reviewing", reviewKey: "saved-case" }} />);
    await act(async () => vi.advanceTimersByTimeAsync(500));

    expect(screen.getByTestId("valuation-signals")).toBe(signals);
    expect(screen.queryByText("2020 Toyota Camry SE")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("The activities shown describe the review.");

    rendered.rerender(<Harness />);
    await act(async () => vi.advanceTimersByTimeAsync(1900));

    expect(screen.queryByRole("heading", { name: "Preparing your valuation" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your valuation result" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    expect(screen.getByRole("contentinfo")).toBeVisible();
    expect(screen.getByRole("main")).toHaveFocus();
    expect(screen.queryByTestId("valuation-signals")).not.toBeInTheDocument();
    rendered.unmount();
  });

  it("releases result actions during the finite exit and does not steal their focus", async () => {
    const rendered = render(<Harness registration={{ phase: "reviewing" }} />);
    const canvas = screen.getByTestId("valuation-signals");
    rendered.rerender(<Harness />);
    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(screen.getByRole("heading", { name: "Your valuation result" })).toBeVisible();
    expect(screen.getByTestId("valuation-signals")).toBe(canvas);
    expect(document.querySelector("[data-exiting]")).toHaveAttribute("aria-hidden", "true");
    const action = screen.getByRole("button", { name: "Review and analyze" });
    action.focus();
    await act(async () => vi.advanceTimersByTimeAsync(1800));
    expect(action).toHaveFocus();
    expect(screen.queryByTestId("valuation-signals")).not.toBeInTheDocument();
  });

  it("clears preview controls and shows the current phase when a saved case replaces the preview", async () => {
    const rendered = render(<Harness registration={{ phase: "reviewing", reviewKey: "synthetic-preview", development: true, vehicle: "2020 Toyota Camry SE" }} />);
    expect(screen.getByText("Synthetic preview")).toBeVisible();
    expect(screen.getByRole("button", { name: "Replay gathering" })).toBeVisible();

    rendered.rerender(<Harness registrationKey="saved-case" registration={{ phase: "connecting", reviewKey: "saved-case" }} />);
    await act(async () => vi.advanceTimersByTimeAsync(500));

    expect(screen.getByText("Connecting to your review")).toBeVisible();
    expect(screen.queryByText("2020 Toyota Camry SE")).not.toBeInTheDocument();
    expect(screen.queryByText("Synthetic preview")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Replay gathering" })).not.toBeInTheDocument();
  });

  it("keeps a synthetic review running through repeated message cycles until its owner leaves", async () => {
    const rendered = render(<Harness registration={{ phase: "reviewing", development: true }} />);
    const signals = screen.getByTestId("valuation-signals");
    expect(screen.getByText("Synthetic preview")).toBeVisible();

    const messages = new Set<string>();
    for (let iteration = 0; iteration < 12; iteration += 1) {
      messages.add(document.querySelector(".free-valuation-processing__message")?.textContent ?? "");
      await act(async () => vi.advanceTimersByTimeAsync(6_800));
      expect(screen.getByRole("heading", { name: "Preparing your valuation" })).toBeVisible();
      expect(screen.getByTestId("valuation-signals")).toBe(signals);
      expect(screen.queryByRole("heading", { name: "Your valuation result" })).not.toBeInTheDocument();
    }
    expect(messages.size).toBeGreaterThanOrEqual(4);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    rendered.unmount();
    expect(screen.queryByTestId("valuation-signals")).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restores the result promptly when reduced motion is requested", async () => {
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const rendered = render(<Harness registration={{ phase: "opening" }} />);
    expect(screen.getByText("Opening your valuation")).toBeVisible();

    rendered.rerender(<Harness />);
    await act(async () => vi.advanceTimersByTimeAsync(10));

    expect(screen.queryByTestId("valuation-signals")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your valuation result" })).toBeVisible();
    expect(screen.getByRole("main")).toHaveFocus();
    rendered.unmount();
  });

  it("keeps a saved-intake error and explicit retry accessible without showing ongoing check messages", async () => {
    const onRetry = vi.fn();
    const registration = {
      phase: "preparing" as const,
      error: "We couldn’t confirm the saved intake. Try again.",
      onRetry,
    };
    const rendered = render(<Harness registration={registration} />);
    expect(screen.getByRole("alert")).toHaveTextContent(registration.error);
    expect(screen.getByRole("heading", { name: "Let’s try again" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();

    rendered.rerender(<Harness registration={{ ...registration, retryDisabled: true }} />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeDisabled();
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(screen.getByRole("alert")).toHaveTextContent(registration.error);
    expect(screen.queryByText("Finding comparable vehicles")).not.toBeInTheDocument();
  });
});
