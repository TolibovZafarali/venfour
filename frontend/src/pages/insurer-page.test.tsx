import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { matchRoutes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicRoutes } from "@/app/router";
import type * as PublicSiteConfiguration from "@/config/public-site";
import * as guideLoader from "@/features/insurers/guide-loader";
import { footerInsurers, insurers, insurerDirectoryMetadata, insurerMetadata, insurerPath } from "@/features/insurers/insurers";
import { stateMetadata, states } from "@/features/states/states";
import { renderTestApp } from "@/test/render";

const intakeConfiguration = vi.hoisted(() => ({ closed: false }));
vi.mock("@/config/public-site", async importOriginal => ({
  ...await importOriginal<typeof PublicSiteConfiguration>(),
  get publicIntakeClosed() { return intakeConfiguration.closed; },
}));

let descriptionMeta: HTMLMetaElement;
beforeEach(() => {
  intakeConfiguration.closed = false;
  descriptionMeta = document.createElement("meta");
  descriptionMeta.name = "description";
  document.head.append(descriptionMeta);
});
afterEach(() => descriptionMeta.remove());

async function renderGuide(path: string) {
  const result = renderTestApp([path], { authService: null });
  await screen.findByRole("heading", { level: 1 });
  return result;
}

describe("insurer guides", () => {
  it.each(insurers)("renders $name with its guide, sources, metadata, and shared terms", async insurer => {
    expect(matchRoutes(publicRoutes, insurerPath(insurer))?.at(-1)?.route.path).toBe("insurers/:insurerSlug");
    await renderGuide(insurerPath(insurer));
    const article = screen.getByRole("article");
    expect(within(article).getByRole("heading", { level: 1 })).toHaveTextContent(`Understand your ${insurer.name} total-loss offer.`);
    expect(within(article).getAllByRole("heading", { level: 2 }).slice(0, 5).map(heading => heading.textContent)).toEqual([
      "Get your claim documents",
      "Understand your valuation",
      "Request a review",
      "How Venfour helps",
      "Common questions",
    ]);
    expect(within(article).getByRole("link", { name: "All insurer guides" })).toHaveAttribute("href", "/insurers");
    expect(within(article).getAllByRole("link").some(link => link.getAttribute("href") === "/#states")).toBe(true);
    expect(article).toHaveTextContent(/independent|not affiliated/i);
    expect(article.querySelector("details:not([open])")).toBeNull();
    expect(article).toHaveTextContent(/Sources checked [A-Z][a-z]+ \d{1,2}, \d{4}/);
    const content = await guideLoader.loadInsurerGuide(insurer);
    expect(article.querySelector("time")).toHaveAttribute("datetime", content.checkedOn);
    const sourceLinks = within(article).getAllByRole("link").map(link => link.getAttribute("href"));
    for (const source of content.sources) expect(sourceLinks).toContain(source.url);
    for (const faq of content.faqs) expect(within(article).getByRole("heading", { name: faq.title })).toBeVisible();
    expect(within(article).getByRole("heading", { name: "Can I start without my insurer’s valuation report?" })).toBeVisible();
    expect(within(article).getByRole("heading", { name: "Does Venfour guarantee a higher offer?" })).toBeVisible();
    const contents = within(article).getByRole("navigation", { name: "On this page" });
    const sectionLinks = within(contents).getAllByRole("link");
    expect(sectionLinks).toHaveLength(5);
    for (const [index, section] of ["documents", "value", "review", "service", "faq"].entries()) {
      const target = document.getElementById(`${insurer.slug}-${section}-title`);
      expect(target?.tagName).toBe("H2");
      expect(target).toHaveAttribute("tabindex", "-1");
      expect(new URL(sectionLinks[index].getAttribute("href")!, "https://venfour.com").hash).toBe(`#${target!.id}`);
    }
    const ids = [...article.querySelectorAll("[id]")].map(element => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    const checklist = within(article).getByRole("table");
    expect(within(checklist).getAllByRole("columnheader")).toHaveLength(2);
    for (const label of ["Vehicle details", "Mileage and condition", "Comparable vehicles", "Adjustments"]) {
      expect(within(checklist).getByText(label, { exact: true })).toBeVisible();
    }
    expect(article.querySelector("blockquote")).toHaveTextContent(/Could you review this/);
    const service = within(article).getByRole("region", { name: "How Venfour helps" });
    expect(service).toHaveTextContent("one-time payment of $199");
    expect(service).toHaveTextContent("A complete insurer valuation report is required");
    expect(service).toHaveTextContent("fee is refunded automatically");
    expect(service).toHaveTextContent("keep access to your completed review and report");
    expect(service).toHaveTextContent("final verified vehicle-value increase is under $1,000");
    expect(service).toHaveTextContent("required documentation");
    expect(service).toHaveTextContent("within 30 days after receiving the insurer’s final written response");
    expect(service).toHaveTextContent("change in vehicle valuation, rather than the total settlement check");
    expect(within(service).getByRole("link", { name: "Read the Fair-Result Refund Policy" })).toHaveAttribute("href", "/refund-policy");
    const actions = within(article).getAllByRole("link", { name: "Start my free valuation" });
    expect(actions).toHaveLength(2);
    for (const action of actions) expect(action).toHaveAttribute("href", "/start?service=total-loss");
    const metadata = insurerMetadata(insurer);
    await waitFor(() => expect(document.title).toBe(metadata.title));
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute("content", metadata.description);
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute("href", metadata.canonical);
    expect(document.querySelector('meta[property="og:title"]')).toHaveAttribute("content", metadata.title);
    expect(document.querySelector('meta[property="og:description"]')).toHaveAttribute("content", metadata.description);
    expect(document.querySelector('meta[property="og:url"]')).toHaveAttribute("content", metadata.canonical);
  });

  it.each(insurers)("preserves both closed-intake contact actions for $name", async insurer => {
    intakeConfiguration.closed = true;
    await renderGuide(insurerPath(insurer));
    const article = screen.getByRole("article");
    expect(within(article).queryByRole("link", { name: "Start my free valuation" })).not.toBeInTheDocument();
    const actions = within(article).getAllByRole("link", { name: "Contact Venfour" });
    expect(actions).toHaveLength(2);
    for (const action of actions) expect(action).toHaveAttribute("href", "/contact");
    expect(article).toHaveTextContent("Online reviews are opening soon.");
  });

  it.each(["/insurers/aaa", "/insurers/AAA-CSAA", "/insurers/aaa-csaa/extra", "/insurers/not-an-insurer", "/insurers/GEICO", "/insurers/State-Farm", "/insurers/state-farm/extra"])("does not invent a guide for %s", async path => {
    const load = vi.spyOn(guideLoader, "loadInsurerGuide");
    await renderGuide(path);
    expect(screen.getByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it("uses the retryable route error screen when a guide download fails", async () => {
    vi.spyOn(guideLoader, "loadInsurerGuide").mockRejectedValueOnce(new Error("Guide download failed"));
    await renderGuide("/insurers/geico");
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn’t display this page.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    expect(document.querySelector('link[rel="canonical"]')).toBeNull();
  });

  it("keeps the existing intake URL without adding insurer information", async () => {
    const user = userEvent.setup();
    const { router } = await renderGuide("/insurers/geico");
    const article = screen.getByRole("article");
    expect(within(article).queryByRole("combobox")).not.toBeInTheDocument();
    await user.click(within(article).getAllByRole("link", { name: "Start my free valuation" })[0]);
    expect(router.state.location.pathname).toBe("/start");
    expect(router.state.location.search).toBe("?service=total-loss");
  });

  it("replaces guide content and sources when navigating between insurers and states", async () => {
    const { router } = await renderGuide("/insurers/geico?source=example");
    const geico = insurers.find(insurer => insurer.slug === "geico")!;
    const next = insurers.find(insurer => insurer.slug === "state-farm")!;
    const geicoSources = (await guideLoader.loadInsurerGuide(geico)).sources;
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute("href", insurerMetadata(geico).canonical);
    await act(() => router.navigate("/insurers/state-farm/"));
    const article = screen.getByRole("article");
    expect(within(article).getByRole("heading", { level: 1 })).toHaveTextContent("Understand your State Farm total-loss offer.");
    expect(document.getElementById("geico-documents-title")).toBeNull();
    const currentLinks = within(article).getAllByRole("link").map(link => link.getAttribute("href"));
    for (const source of geicoSources) expect(currentLinks).not.toContain(source.url);
    expect(document.title).toBe(insurerMetadata(next).title);
    expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
    expect(document.querySelector('meta[property="og:url"]')).toHaveAttribute("content", insurerMetadata(next).canonical);
    await act(() => router.navigate("/states/missouri"));
    expect(document.title).toBe(stateMetadata(states.find(state => state.code === "MO")!).title);
    expect(document.getElementById("state-farm-documents-title")).toBeNull();
    await act(() => router.navigate("/methodology"));
    expect(document.title).toBe("Total-Loss Review Methodology | Venfour");
    expect(document.querySelector("[data-page-metadata]")).toBeNull();
  });
});

describe("insurer directory and discovery", () => {
  it("lists all insurers alphabetically with directory metadata and no guide download", async () => {
    const load = vi.spyOn(guideLoader, "loadInsurerGuide");
    expect(matchRoutes(publicRoutes, "/insurers")?.at(-1)?.route.path).toBe("insurers");
    await renderGuide("/insurers");
    const main = screen.getByRole("main");
    const guideLinks = within(main).getAllByRole("link").filter(link => insurers.some(insurer => insurerPath(insurer) === link.getAttribute("href")));
    expect(guideLinks).toHaveLength(insurers.length);
    expect(guideLinks.map(link => link.getAttribute("href"))).toEqual([...insurers].sort((a, b) => a.name.localeCompare(b.name)).map(insurerPath));
    for (const insurer of insurers) expect(main).toHaveTextContent(insurer.name);
    expect(within(main).queryByRole("searchbox")).not.toBeInTheDocument();
    expect(within(main).queryByRole("combobox")).not.toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
    expect(document.title).toBe(insurerDirectoryMetadata.title);
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute("content", insurerDirectoryMetadata.description);
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute("href", insurerDirectoryMetadata.canonical);
  });

  it("exposes the curated guides and full directory from the public footer", async () => {
    const user = userEvent.setup();
    const { router } = await renderGuide("/insurers");
    const footer = screen.getByRole("navigation", { name: "Footer insurance companies" });
    expect(within(footer).getAllByRole("link")).toHaveLength(footerInsurers.length + 1);
    for (const insurer of footerInsurers) {
      expect(within(footer).getByRole("link", { name: insurer.name })).toHaveAttribute("href", insurerPath(insurer));
    }
    expect(within(footer).queryByRole("link", { name: "Amica" })).not.toBeInTheDocument();
    expect(within(footer).getByRole("link", { name: /All insurer guides/ })).toHaveAttribute("href", "/insurers");
    await user.click(within(footer).getByRole("link", { name: "Liberty Mutual" }));
    await screen.findByRole("heading", { level: 1, name: "Understand your Liberty Mutual total-loss offer." });
    expect(router.state.location.pathname).toBe("/insurers/liberty-mutual");
  });
});
