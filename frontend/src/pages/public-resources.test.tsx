import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ValuationChecklistPage } from "./public-resources";

describe("valuation review checklist", () => {
  it("tracks independent checks, supports reset, and invokes printing", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ValuationChecklistPage /></MemoryRouter>);
    const report = screen.getByRole("checkbox", { name: /Keep the full valuation report/ });
    const payment = screen.getByRole("checkbox", { name: /Keep the proposed payment breakdown/ });
    expect(screen.getByRole("button", { name: "Reset checks" })).toBeDisabled();
    await user.click(report);
    await user.click(payment);
    expect(screen.getByRole("status")).toHaveTextContent("2 of 12 checked");
    await user.click(report);
    expect(payment).toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent("1 of 12 checked");
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    try {
      await user.click(screen.getByRole("button", { name: "Print checklist" }));
      expect(print).toHaveBeenCalledOnce();
      expect(payment).toBeChecked();
    } finally { print.mockRestore(); }
    await user.click(screen.getByRole("button", { name: "Reset checks" }));
    expect(screen.getAllByRole("checkbox").every(box => !(box as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("0 of 12 checked");
  });
});
