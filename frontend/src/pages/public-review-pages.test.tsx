import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as SiteBoundary from "@/app/site-boundary";
import { publicReviewMetadata, sampleReportPdfPath } from "@/config/public-review";
import { fullReviewPriceLabel } from "@/config/review-price";
import { renderTestApp } from "@/test/render";

const configuration = vi.hoisted(() => ({ intakeClosed: false, origin: "http://localhost:5173" }));
vi.mock("@/config/public-site", () => ({ publicSiteOnly: true, get publicIntakeClosed() { return configuration.intakeClosed; } }));
vi.mock("@/app/site-boundary", async importOriginal => {
  const actual = await importOriginal<typeof SiteBoundary>();
  return {
    ...actual,
    applicationHref: (path?: string) => actual.applicationHref(path, configuration.origin),
    publicHref: (path?: string) => actual.publicHref(path, configuration.origin),
  };
});

let description: HTMLMetaElement;
beforeEach(() => {
  configuration.intakeClosed = false;
  configuration.origin = "http://localhost:5173";
  description = document.createElement("meta");
  description.name = "description";
  document.head.append(description);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => description.remove());

describe("public review information", () => {
  it("explains the advertised price, conditional deliverables, and both refund protections", () => {
    renderTestApp(["/pricing"], { authService: null });
    const main = within(screen.getByRole("main"));
    expect(main.getByRole("heading", { level: 1, name: "Pricing & what’s included" })).toBeVisible();
    expect(main.getByRole("region", { name: "Total-Loss Valuation Report price" })).toHaveTextContent(`${fullReviewPriceLabel} USD`);
    expect(main.getByText("One-time payment · No subscription")).toBeVisible();
    expect(main.getByText(/paid review requires a complete insurer valuation report/u)).toBeVisible();
    expect(main.getByText(/reconsideration request.+when the evidence supports it/u)).toBeVisible();
    expect(main.getByText(/fee is refunded automatically.+report stays available/u)).toBeVisible();
    expect(main.getByText(/may request a full refund.+less than/u)).toHaveTextContent("$1,000");
    expect(main.getByText(/documentation.+within 30 days/u)).toBeVisible();
    expect(main.getByRole("link", { name: /See eligibility and refund terms/u })).toHaveAttribute("href", "/refund-policy");
    expect(main.getByText(/Venfour does not negotiate on your behalf/u)).toBeVisible();
    expect(main.getByText(/Payment does not guarantee a higher insurer valuation/u)).toBeVisible();
  });

  it.each(["/pricing", "/sample-report"] as const)("sets the title, description and canonical for %s", path => {
    renderTestApp([path], { authService: null });
    const metadata = publicReviewMetadata[path];
    expect(document.title).toBe(metadata.title);
    expect(description.content).toBe(metadata.description);
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute("href", metadata.canonical);
    expect(document.querySelector('meta[property="og:url"]')).toHaveAttribute("content", metadata.canonical);
  });

  it("identifies the sample as fictional and offers opening and downloading the same PDF", () => {
    renderTestApp(["/sample-report"], { authService: null });
    const main = within(screen.getByRole("main"));
    expect(main.getByText(/All case details.+outcomes.+fictional/u)).toBeVisible();
    expect(main.getByText(/not an exact application export/u)).toBeVisible();
    expect(main.getByText(/overview prepared for attorney readers/u)).toBeVisible();
    const open = main.getByRole("link", { name: "Open sample PDF (6 pages) (opens in a new tab)" });
    expect(open).toHaveAttribute("href", sampleReportPdfPath);
    expect(open).toHaveAttribute("target", "_blank");
    expect(open).toHaveAttribute("rel", "noopener noreferrer");
    const download = main.getByRole("link", { name: "Download sample PDF" });
    expect(download).toHaveAttribute("href", sampleReportPdfPath);
    expect(download).toHaveAttribute("download", "Venfour-Sample-Total-Loss-Review.pdf");
    expect(main.getByRole("link", { name: "Pricing & what’s included" })).toHaveAttribute("href", "/pricing");
  });

  it.each([
    { origin: "http://localhost:5173", closed: false },
    { origin: "http://localhost:5173", closed: true },
    { origin: "https://venfour.com", closed: false },
    { origin: "https://venfour.com", closed: true },
  ])("keeps footer destinations and intake correct at $origin with intake closed=$closed", ({ origin, closed }) => {
    configuration.origin = origin;
    configuration.intakeClosed = closed;
    renderTestApp(["/pricing"], { authService: null });
    const appOrigin = origin === "https://venfour.com" ? "https://app.venfour.com" : "";
    const footer = within(screen.getByRole("navigation", { name: "Footer navigation" }));
    expect(footer.getByRole("link", { name: "Pricing & what’s included" })).toHaveAttribute("href", "/pricing");
    expect(footer.getByRole("link", { name: "Find your review" })).toHaveAttribute("href", `${appOrigin}/find-review`);
    expect(footer.getByRole("link", { name: "View a sample report" })).toHaveAttribute("href", "/sample-report");
    expect(footer.getByRole("link", { name: "Frequently asked questions" })).toHaveAttribute("href", "/#faq");
    const main = within(screen.getByRole("main"));
    expect(main.getByRole("link", { name: closed ? "Contact Venfour" : "Start my free valuation" })).toHaveAttribute("href", closed ? "/contact" : `${appOrigin}/start?service=total-loss`);
    if (closed) expect(main.queryByRole("link", { name: "Start my free valuation" })).not.toBeInTheDocument();
  });

  it("takes a visitor from pricing to the sample and then focuses the homepage FAQ", async () => {
    const user = userEvent.setup();
    const { router } = renderTestApp(["/pricing"], { authService: null });
    await user.click(within(screen.getByRole("main")).getByRole("link", { name: "View a sample report" }));
    expect(router.state.location.pathname).toBe("/sample-report");
    await user.click(within(screen.getByRole("navigation", { name: "Footer navigation" })).getByRole("link", { name: "Frequently asked questions" }));
    await waitFor(() => expect(document.getElementById("faq")).toHaveFocus());
    expect(router.state.location.pathname).toBe("/");
  });
});
