import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { matchRoutes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicRoutes } from "@/app/router";
import type * as PublicSiteConfiguration from "@/config/public-site";
import { renderTestApp } from "@/test/render";
import { states, statePath, stateMetadata } from "@/features/states/states";
import * as guideLoader from "@/features/states/guide-loader";

const intakeConfiguration = vi.hoisted(() => ({ closed: false }));
vi.mock("@/config/public-site", async importOriginal => ({
  ...await importOriginal<typeof PublicSiteConfiguration>(),
  get publicIntakeClosed() { return intakeConfiguration.closed; },
}));

const missouriTitle = "Missouri Total-Loss Guide & Valuation Review | Venfour";
const missouriDescription = "Understand Missouri total-loss valuations, deductions, replacement-vehicle tax allowances, and your options. Start with Venfour’s free preliminary valuation.";

let descriptionMeta: HTMLMetaElement;
beforeEach(() => {
  intakeConfiguration.closed = false;
  descriptionMeta = document.createElement("meta");
  descriptionMeta.name = "description";
  document.head.append(descriptionMeta);
});
afterEach(() => descriptionMeta.remove());

async function renderState(path: string) {
  const result = renderTestApp([path], { authService: null });
  await screen.findByRole("heading", { level: 1 });
  return result;
}

describe("state pages", () => {
  it("uses the existing route error screen if a guide cannot load", async () => {
    const load = vi.spyOn(guideLoader, "loadStateGuide").mockRejectedValueOnce(new Error("Guide download failed"));
    try {
      await renderState("/states/texas");
      expect(screen.getByRole("alert")).toHaveTextContent("We couldn’t display this page.");
      expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
      expect(screen.queryByRole("article")).not.toBeInTheDocument();
    } finally {
      load.mockRestore();
    }
  });

  it.each(states)("renders $name with its researched guide and shared terms", async state => {
    const matches = matchRoutes(publicRoutes, statePath(state));
    expect(matches?.at(-1)?.route.path).toBe("states/:stateSlug");
    await renderState(statePath(state));
    const article = screen.getByRole("article");
    expect(within(article).getByRole("heading", { level: 1 })).toHaveTextContent(`${state.name}.`);
    await waitFor(() => expect(document.title).toBe(stateMetadata(state).title));
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute("content", stateMetadata(state).description);
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute("href", stateMetadata(state).canonical);
    expect(within(article).getByRole("heading", { name: `${state.name} rules worth understanding` })).toBeVisible();
    expect(within(article).getByRole("table")).toBeVisible();
    expect(article.querySelector("details:not([open])")).toBeNull();
    const content = await guideLoader.loadStateGuide(state);
    expect(article.querySelector("time")).toHaveAttribute("datetime", content.checkedOn);
    const sourceLinks = within(article).getAllByRole("link").map(link => link.getAttribute("href"));
    for (const source of content.sources) expect(sourceLinks).toContain(source.url);
    for (const faq of content.faqs) expect(within(article).getByRole("heading", { name: faq.title })).toBeVisible();
    const sectionIds = [...article.querySelectorAll("[id]")].map(element => element.id);
    expect(new Set(sectionIds).size).toBe(sectionIds.length);
    const actions = within(article).getAllByRole("link", { name: "Start my free valuation" });
    expect(actions).toHaveLength(2);
    for (const action of actions) expect(action).toHaveAttribute("href", "/start?service=total-loss");
    const service = within(article).getByRole("region", { name: "How Venfour helps" });
    expect(service).toHaveTextContent("one-time payment of $199");
    expect(service).toHaveTextContent("fee is refunded automatically");
    expect(service).toHaveTextContent("final verified vehicle-value increase is under $1,000");
    expect(service).toHaveTextContent("required documentation");
    expect(service).toHaveTextContent("within 30 days after receiving the insurer’s final written response");
    const contents = within(article).getByRole("navigation", { name: "On this page" });
    for (const link of within(contents).getAllByRole("link")) {
      const hash = new URL(link.getAttribute("href")!, "https://venfour.com").hash;
      expect(document.getElementById(hash.slice(1))).toHaveAttribute("tabindex", "-1");
    }
  });

  it.each(states)("preserves both closed-intake contact actions for $name", async state => {
    intakeConfiguration.closed = true;
    await renderState(statePath(state));
    const article = screen.getByRole("article");
    expect(within(article).queryByRole("link", { name: "Start my free valuation" })).not.toBeInTheDocument();
    const actions = within(article).getAllByRole("link", { name: "Contact Venfour" });
    expect(actions).toHaveLength(2);
    for (const action of actions) expect(action).toHaveAttribute("href", "/contact");
  });

  it("renders Missouri’s guide with an accessible checklist and expanded answers", async () => {
    const matches = matchRoutes(publicRoutes, "/states/missouri");
    expect(matches?.at(-1)?.route.path).toBe("states/:stateSlug");
    await renderState("/states/missouri");
    const article = screen.getByRole("article");
    expect(within(article).getByRole("heading", { level: 1 })).toHaveTextContent("Understand your total-loss offer in Missouri.");
    const sectionTitles = within(article).getAllByRole("heading", { level: 2 }).map(heading => heading.textContent);
    expect(sectionTitles.slice(0, 5)).toEqual([
      "How is your vehicle’s value determined?",
      "Missouri rules worth understanding",
      "What to do if the offer seems low",
      "How Venfour helps",
      "Common questions",
    ]);
    expect(within(article).getByRole("heading", { name: "Four things to check in your report" })).toBeVisible();
    const checklist = within(article).getByRole("table");
    expect(within(checklist).getAllByRole("columnheader")).toHaveLength(2);
    for (const detail of ["Vehicle details", "Mileage and condition", "Comparable vehicles", "Adjustments"]) {
      expect(within(checklist).getByText(detail, { exact: true })).toBeVisible();
    }
    expect(article.querySelector("blockquote")).toHaveTextContent("Could you review this and explain whether it changes the vehicle value?");
    expect(within(article).getByRole("heading", { name: "Can an appraisal clause help resolve a disagreement?" })).toBeVisible();
    expect(within(article).getByText(/If your policy includes an appraisal clause/)).toBeVisible();
    expect(article.querySelector("details:not([open])")).toBeNull();
    expect(article).toHaveTextContent(/Sources checked [A-Z][a-z]+ \d{1,2}, \d{4}/);
    const contents = within(article).getByRole("navigation", { name: "On this page" });
    const sectionLinks = within(contents).getAllByRole("link");
    expect(sectionLinks).toHaveLength(5);
    for (const link of sectionLinks) {
      const destination = new URL(link.getAttribute("href")!, "http://localhost/states/missouri");
      expect(destination.pathname).toBe("/states/missouri");
      const target = document.getElementById(destination.hash.slice(1));
      expect(target?.tagName).toBe("H2");
      expect(target).toHaveAttribute("tabindex", "-1");
    }
    expect(within(article).getByRole("link", { name: "All states" })).toHaveAttribute("href", "/#states");
    expect(document.title).toBe(missouriTitle);
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute("content", missouriDescription);
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute("href", "https://venfour.com/states/missouri");
  });

  it("keeps Missouri’s qualifications and corrected official source links with the guidance", async () => {
    await renderState("/states/missouri");
    const article = screen.getByRole("article");
    const sourceLinks = within(article).getAllByRole("link").map(link => link.getAttribute("href"));
    expect(sourceLinks).toEqual(expect.arrayContaining([
      "https://insurance.mo.gov/consumer-faqs/auto-insurance-faqs",
      "https://s1.sos.mo.gov/cmsimages/adrules/csr/current/20csr/20c100-1.pdf#page=4",
      "https://revisor.mo.gov/main/OneSection.aspx?section=301.010",
      "https://dor.mo.gov/faq/motor-vehicle/titling-registration.html#q13",
      "https://insurance.mo.gov/consumer-complaints/insurance-complaints",
      "https://insurance.mo.gov/understanding-your-automobile-insurance-policy",
    ]));
    expect(sourceLinks).not.toContain("https://dor.mo.gov/faq/motor-vehicle/titling-registration.html#q30");
    expect(sourceLinks).not.toContain("https://insurance.mo.gov/consumers/auto/documents/AFA10.pdf");
    expect(article).toHaveTextContent(/exceeds 80%/);
    expect(article).toHaveTextContent(/no more than six years after/);
    expect(article).toHaveTextContent(/hail damage and inflatable safety restraints/);
    expect(article).toHaveTextContent(/does not determine your settlement amount/);
    expect(article).toHaveTextContent(/kept in the claim file/);
    expect(article).toHaveTextContent(/notarized|notarization/);
    expect(article).toHaveTextContent(/unless the insurance agent certifies/);
    expect(article).toHaveTextContent(/At least one owner of the totaled vehicle must also be listed on the replacement vehicle’s title application/);
    expect(article).toHaveTextContent(/180 days after the total-loss payment/);
  });

  it("describes the paid review and two separate refund protections", async () => {
    await renderState("/states/missouri");
    const service = screen.getByRole("region", { name: "How Venfour helps" });
    expect(service).toHaveTextContent("one-time payment of $199");
    expect(service).toHaveTextContent("A complete insurer valuation report is required");
    expect(service).toHaveTextContent(/fee is refunded automatically/);
    expect(service).toHaveTextContent(/keep access to your completed review and report/);
    expect(service).toHaveTextContent(/final verified vehicle-value increase is under \$1,000/);
    expect(service).toHaveTextContent(/completing the Venfour-supported reconsideration process/);
    expect(service).toHaveTextContent(/required documentation/);
    expect(service).toHaveTextContent(/within 30 days after receiving the insurer’s final written response/);
    expect(service).toHaveTextContent(/change in vehicle valuation, rather than the total settlement check/);
    expect(within(service).getByRole("link", { name: "Read the Fair-Result Refund Policy" })).toHaveAttribute("href", "/refund-policy");
  });

  it.each(["/states", "/states/not-a-state", "/states/Missouri", "/states/missouri/extra"])("does not invent a page for %s", async path => {
    await renderState(path);
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it("keeps the CTA in the existing intake and introduces no state fields", async () => {
    const user = userEvent.setup();
    const { router } = await renderState("/states/missouri");
    const article = screen.getByRole("article");
    expect(within(article).queryByRole("combobox")).not.toBeInTheDocument();
    const cta = within(article).getAllByRole("link", { name: "Start my free valuation" });
    expect(cta).toHaveLength(2);
    for (const link of cta) expect(link).toHaveAttribute("href", "/start?service=total-loss");
    await user.click(cta[0]);
    expect(router.state.location.pathname).toBe("/start");
    expect(router.state.location.search).toBe("?service=total-loss");
  });

  it("provides two contact alternatives while intake is closed", async () => {
    intakeConfiguration.closed = true;
    const user = userEvent.setup();
    const { router } = await renderState("/states/missouri");
    const article = screen.getByRole("article");
    expect(within(article).queryByRole("link", { name: "Start my free valuation" })).not.toBeInTheDocument();
    const contactLinks = within(article).getAllByRole("link", { name: "Contact Venfour" });
    expect(contactLinks).toHaveLength(2);
    for (const link of contactLinks) expect(link).toHaveAttribute("href", "/contact");
    expect(article).toHaveTextContent("Online reviews are opening soon.");
    await user.click(contactLinks[1]);
    expect(router.state.location.pathname).toBe("/contact");
  });

  it("updates metadata on state navigation and clears state tags when leaving", async () => {
    const { router } = await renderState("/states/missouri?source=example");
    expect(document.title).toBe(missouriTitle);
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute("content", missouriDescription);
    expect(document.querySelector('meta[property="og:url"]')).toHaveAttribute("content", "https://venfour.com/states/missouri");
    await act(() => router.navigate("/states/new-york/"));
    expect(document.title).toBe("New York Total-Loss Guide & Valuation Review | Venfour");
    expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute("href", "https://venfour.com/states/new-york");
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute("content", stateMetadata(states.find(state => state.code === "NY")!).description);
    await act(() => router.navigate("/states/missouri"));
    expect(document.title).toBe(missouriTitle);
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute("content", missouriDescription);
    await act(() => router.navigate("/methodology"));
    expect(document.title).toBe("Total-Loss Review Methodology | Venfour");
    expect(document.querySelector("[data-state-metadata]")).toBeNull();
  });
});
