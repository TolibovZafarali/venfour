import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type * as SupportConfiguration from "@/config/support";

import { ContactPage } from "./contact-page";

const contactConfiguration = vi.hoisted(() => ({ supportEmail: null as string | null }));
vi.mock("@/config/support", async (importOriginal) => ({
  ...await importOriginal<typeof SupportConfiguration>(),
  get supportEmail() { return contactConfiguration.supportEmail; },
}));

describe("refund support contact", () => {
  it("uses the configured support address for a manual refund request", () => {
    contactConfiguration.supportEmail = "configured-support@example.com";
    render(<MemoryRouter initialEntries={["/contact?topic=fair-result-refund"]}><ContactPage /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Email configured-support@example.com" })).toHaveAttribute(
      "href", "mailto:configured-support@example.com?subject=Refund%20request%20%E2%80%94%20Venfour%20case%20%5Bcase%20number%5D",
    );
    expect(screen.getByText(/within 30 days after receiving/u)).toBeVisible();
    expect(screen.getByText(/Identify your case.+Provide the final response/u)).toBeVisible();
    expect(screen.getByRole("link", { name: "See what to include in your refund request" })).toHaveAttribute(
      "href", "/refund-policy#how-to-request-a-refund",
    );
  });

  it("does not invent a refund address when support configuration is invalid", () => {
    contactConfiguration.supportEmail = null;
    render(<MemoryRouter initialEntries={["/contact?topic=fair-result-refund"]}><ContactPage /></MemoryRouter>);
    expect(screen.getByText("Direct email support is not currently available through this site.")).toBeVisible();
    expect(screen.queryByRole("link", { name: /^Email /u })).not.toBeInTheDocument();
  });
});
