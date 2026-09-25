import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderTestApp } from "@/test/render";
import { states, footerStates, statePath } from "./states";

describe("nationwide section", () => {
  it("sits between the example and FAQ with 51 named map links", () => {
    renderTestApp(["/"], { authService: null });
    const section = screen.getByRole("region", { name: "Nationwide support. Local clarity." });
    expect(section.id).toBe("states");
    expect(section.previousElementSibling?.id).toBe("example");
    expect(section.nextElementSibling?.id).toBe("faq");
    const map = screen.getByRole("group", { name: "United States map" });
    expect(within(map).getAllByRole("link")).toHaveLength(51);
    for (const state of states) {
      const link = within(map).getByRole("link", { name: state.name });
      expect(link).toHaveAttribute("href", statePath(state));
      expect(link).toHaveAttribute("tabindex", "0");
      expect(link.querySelector("title")).toHaveTextContent(state.name);
    }
  });

  it("shows the hovered or focused name and follows the state link", async () => {
    const user = userEvent.setup();
    const { router } = renderTestApp(["/"], { authService: null });
    const map = screen.getByRole("group", { name: "United States map" });
    const missouri = within(map).getByRole("link", { name: "Missouri" });
    const caption = document.querySelector(".states-map__caption");
    await user.hover(missouri);
    expect(caption).toHaveTextContent("Missouri");
    await user.unhover(missouri);
    expect(caption).toHaveTextContent("Washington, D.C.");
    act(() => missouri.focus());
    expect(caption).toHaveTextContent("Missouri");
    act(() => missouri.blur());
    expect(caption).toHaveTextContent("Washington, D.C.");
    // SVG anchor keyboard activation is covered in the real-browser suite.
    await user.click(missouri);
    expect(router.state.location.pathname).toBe("/states/missouri");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("in Missouri");
  });

  it("omits the selector and inset hint while keeping a direct D.C. link", async () => {
    const user = userEvent.setup();
    const { router } = renderTestApp(["/"], { authService: null });
    const section = screen.getByRole("region", { name: "Nationwide support. Local clarity." });
    expect(within(section).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(section).queryByText(/Alaska and Hawaii shown as insets/)).not.toBeInTheDocument();
    expect(within(section).queryByText(/choose below/)).not.toBeInTheDocument();
    expect(within(section).queryByText("Find your state")).not.toBeInTheDocument();
    expect(within(section).queryByText("Select a state on the map.")).not.toBeInTheDocument();
    await user.click(within(section).getByRole("link", { name: "Washington, D.C." }));
    expect(router.state.location.pathname).toBe("/states/district-of-columbia");
  });

  it.each(["/", "/states/missouri"])("links the compact footer back to the map from %s", async path => {
    const user = userEvent.setup();
    const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
    const { router } = renderTestApp([path], { authService: null });
    const footer = screen.getByRole("navigation", { name: "Footer states" });
    expect(screen.getByRole("navigation", { name: "Footer navigation" })).toContainElement(footer);
    expect(within(footer).getAllByRole("link")).toHaveLength(11);
    for (const state of footerStates) expect(within(footer).getByRole("link", { name: state.name })).toHaveAttribute("href", statePath(state));
    const allStates = within(footer).getByRole("link", { name: "All states" });
    expect(allStates).toHaveAttribute("href", "/#states");
    await user.click(allStates);
    expect(router.state.location.pathname).toBe("/");
    expect(document.getElementById("states")).toHaveFocus();
    expect(scroll).toHaveBeenCalled();
    await user.click(within(screen.getByRole("navigation", { name: "Footer states" })).getByRole("link", { name: "All states" }));
    expect(document.getElementById("states")).toHaveFocus();
  });
});
