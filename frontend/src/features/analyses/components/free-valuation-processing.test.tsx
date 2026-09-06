import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FreeValuationProcessing,
  FreeValuationProcessingProvider,
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
  it("keeps the same signal field and vehicle context through an intake-to-analysis handoff", async () => {
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
    expect(screen.getByText("2020 Toyota Camry SE")).toBeVisible();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("The displayed activities describe the checks included in your review.");

    rendered.rerender(<Harness />);
    await act(async () => vi.advanceTimersByTimeAsync(500));

    expect(screen.queryByRole("heading", { name: "Preparing your valuation" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your valuation result" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    expect(screen.getByRole("contentinfo")).toBeVisible();
    expect(trigger).toHaveFocus();
    rendered.unmount();
  });

  it("clears vehicle context when a different case replaces a synthetic preview", async () => {
    const rendered = render(<Harness registration={{ phase: "reviewing", reviewKey: "synthetic-preview", development: true, vehicle: "2020 Toyota Camry SE" }} />);
    expect(screen.getByText("2020 Toyota Camry SE")).toBeVisible();

    rendered.rerender(<Harness registrationKey="saved-case" registration={{ phase: "connecting", reviewKey: "saved-case" }} />);
    await act(async () => vi.advanceTimersByTimeAsync(500));

    expect(screen.getByText("Connecting to your review")).toBeVisible();
    expect(screen.queryByText("2020 Toyota Camry SE")).not.toBeInTheDocument();
    expect(screen.queryByText("Development preview")).not.toBeInTheDocument();
  });

  it("keeps a synthetic review running through repeated message cycles until its owner leaves", async () => {
    const rendered = render(<Harness registration={{ phase: "reviewing", development: true }} />);
    const signals = screen.getByTestId("valuation-signals");
    expect(screen.getByText("Development preview")).toBeVisible();
    expect(screen.getByText("Continuous · Synthetic data")).toBeVisible();

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
    expect(screen.getByText("Your saved details are still here.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();

    rendered.rerender(<Harness registration={{ ...registration, retryDisabled: true }} />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeDisabled();
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(screen.getByRole("alert")).toHaveTextContent(registration.error);
    expect(screen.queryByText("Finding relevant market listings")).not.toBeInTheDocument();
  });
});
