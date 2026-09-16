import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { ContactPage } from "./contact-page";

const contactConfiguration = vi.hoisted(() => ({ supportEmail: null as string | null }));
vi.mock("@/config/support", () => contactConfiguration);

describe("refund support contact", () => {
  it("uses the configured support address for a manual refund request", () => {
    contactConfiguration.supportEmail = "configured-support@example.com";
    render(<MemoryRouter initialEntries={["/contact?topic=fair-result-refund"]}><ContactPage /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Email configured-support@example.com" })).toHaveAttribute(
      "href", "mailto:configured-support@example.com?subject=Fair-Result%20Refund%20Policy%20request",
    );
    expect(screen.getByText(/within 30 days after receiving/u)).toBeVisible();
    expect(screen.getByText(/Identify your case.+Provide the final response/u)).toBeVisible();
  });

  it("does not invent a refund address when support is unconfigured", () => {
    contactConfiguration.supportEmail = null;
    render(<MemoryRouter initialEntries={["/contact?topic=fair-result-refund"]}><ContactPage /></MemoryRouter>);
    expect(screen.getByText("Direct email support is not currently available through this site.")).toBeVisible();
    expect(screen.queryByRole("link", { name: /^Email /u })).not.toBeInTheDocument();
  });
});
