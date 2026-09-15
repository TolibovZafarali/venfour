import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppEntryLoading, AppEntryLoadingScope } from "./app-entry-loading";

afterEach(() => vi.useRealTimers());

describe("app entry loading", () => {
  it("keeps quick entry quiet and cancels its pending indicator", () => {
    vi.useFakeTimers();
    const view = render(<AppEntryLoading />);
    act(() => vi.advanceTimersByTime(120));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    view.unmount();
    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByText("Opening your workspace…")).not.toBeInTheDocument();
  });

  it("shows one status after 300 ms and removes it immediately when content is ready", () => {
    vi.useFakeTimers();
    const view = render(<AppEntryLoading />);
    act(() => vi.advanceTimersByTime(299));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toHaveTextContent("Opening your workspace…");
    view.rerender(<h1>Your saved review</h1>);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your saved review" })).toBeVisible();
  });

  it("does not restart the delay between authentication and saved-case loading", () => {
    vi.useFakeTimers();
    const view = render(<AppEntryLoadingScope><AppEntryLoading key="authentication" /></AppEntryLoadingScope>);
    act(() => vi.advanceTimersByTime(200));
    view.rerender(<AppEntryLoadingScope><AppEntryLoading key="saved-cases" /></AppEntryLoadingScope>);
    act(() => vi.advanceTimersByTime(100));
    expect(screen.getByRole("status")).toHaveTextContent("Opening your workspace…");
  });
});
