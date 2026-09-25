import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { matchRoutes } from "react-router";
import { describe, expect, it } from "vitest";
import { publicRoutes } from "@/app/router";
import { renderTestApp } from "@/test/render";
import { states, statePath, stateMetadata } from "@/features/states/states";

describe("state pages", () => {
  it.each(states)("renders $name using the public state template", state => {
    const matches = matchRoutes(publicRoutes, statePath(state));
    expect(matches?.at(-1)?.route.path).toBe("states/:stateSlug");
    renderTestApp([statePath(state)], { authService: null });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(`${state.name}.`);
    expect(document.title).toBe(stateMetadata(state).title);
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute("href", `https://venfour.com${statePath(state)}`);
    expect(screen.getByRole("heading", { name: "Start with a free valuation" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "What to have ready" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "If you continue with Venfour" })).toBeVisible();
  });

  it.each(["/states", "/states/not-a-state", "/states/Missouri", "/states/missouri/extra"])("does not invent a page for %s", path => {
    renderTestApp([path], { authService: null });
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it("keeps the CTA in the existing intake and introduces no state fields", async () => {
    const user = userEvent.setup();
    const { router } = renderTestApp(["/states/missouri"], { authService: null });
    const article = screen.getByRole("article");
    expect(article).toHaveTextContent("one-time payment of $199");
    expect(article).toHaveTextContent("complete report is required");
    expect(article).toHaveTextContent("does not provide Missouri-specific");
    expect(within(article).queryByRole("combobox")).not.toBeInTheDocument();
    const cta = within(article).getAllByRole("link", { name: "Start my free valuation" });
    expect(cta).toHaveLength(2);
    expect(cta[0]).toHaveAttribute("href", "/start?service=total-loss");
    await user.click(cta[0]);
    expect(router.state.location.pathname).toBe("/start");
    expect(router.state.location.search).toBe("?service=total-loss");
  });

  it("updates metadata on state navigation and clears state tags when leaving", async () => {
    const { router } = renderTestApp(["/states/missouri?source=example"], { authService: null });
    expect(document.querySelector('meta[property="og:url"]')).toHaveAttribute("content", "https://venfour.com/states/missouri");
    await act(() => router.navigate("/states/new-york/"));
    expect(document.title).toBe("New York Total-Loss Valuation Review | Venfour");
    expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute("href", "https://venfour.com/states/new-york");
    await act(() => router.navigate("/methodology"));
    expect(document.title).toBe("Total-Loss Review Methodology | Venfour");
    expect(document.querySelector("[data-state-metadata]")).toBeNull();
  });
});
