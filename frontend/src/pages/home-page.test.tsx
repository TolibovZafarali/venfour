import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { renderTestApp } from "@/test/render";

async function homepageHero() {
  const hero = (
    await screen.findByRole("heading", {
      level: 1,
      name: "Your Vehicle’s Value, Made Clear.",
    })
  ).closest("section");
  if (!hero) throw new Error("The homepage hero was not rendered.");
  return hero;
}

describe("homepage structure", () => {
  test("leads with the Total Loss review, a simple example, and saved-review recovery", async () => {
    renderTestApp();
    const hero = await homepageHero();

    expect(
      within(hero).getByRole("link", { name: "Start Total Loss review" }),
    ).toHaveAttribute("href", "/start?service=total-loss");
    expect(
      within(hero).getByRole("link", { name: "See a simple example" }),
    ).toHaveAttribute("href", "/#example");
    expect(
      within(hero).getByRole("link", { name: "Find my review" }),
    ).toHaveAttribute("href", "/find-review");
    expect(within(hero).queryByRole("figure")).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Vehicle ZIP code")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("form", { name: "Start total-loss appraisal" }),
    ).not.toBeInTheDocument();
  });

  test("keeps an available Total Loss service and a clearly paused Diminished Value service", async () => {
    renderTestApp();
    await screen.findByRole("heading", { name: "Start with your situation." });
    const services = document.getElementById("services");
    if (!services) throw new Error("The services section was not rendered.");

    expect(services.querySelectorAll("article")).toHaveLength(2);
    for (const [id, heading] of [
      ["total-loss", "Your vehicle was totaled"],
      ["diminished-value", "Your vehicle was repaired"],
    ]) {
      const service = document.getElementById(id);
      expect(service).toBeVisible();
      expect(service).toHaveAttribute("tabindex", "-1");
      expect(service).toContainElement(
        within(services).getByRole("heading", { name: heading }),
      );
    }
    expect(
      within(services).getByRole("link", { name: "Start Total Loss review" }),
    ).toHaveAttribute("href", "/start?service=total-loss");
    const diminishedValue = document.getElementById("diminished-value")!;
    expect(diminishedValue).toHaveTextContent(/intake.*paused/i);
    expect(
      within(diminishedValue).getByRole("link", { name: /service update/i }),
    ).toHaveAttribute("href", "/start?service=diminished-value");
    expect(
      screen.queryByRole("link", { name: "Submit diminished-value request" }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('a[href*="vehicle-value"]')).not.toBeInTheDocument();
  });

  test("explains the three steps without repeating illustrated examples", async () => {
    renderTestApp();
    await screen.findByRole("heading", { name: "Start online in a few steps" });
    const process = document.getElementById("how-it-works");
    if (!process) throw new Error("The process section was not rendered.");

    expect(process).toHaveAttribute("tabindex", "-1");
    expect(process.querySelector("ol")?.children).toHaveLength(3);
    expect(within(process).queryByRole("figure")).not.toBeInTheDocument();
    for (const step of [
      "Add your valuation details",
      "Venfour checks the market",
      "See the evidence review",
    ]) {
      expect(within(process).getByRole("heading", { name: step })).toBeVisible();
    }
    expect(process).toHaveTextContent(/report/i);
    expect(process).toHaveTextContent(/enter.*details/i);
  });

  test("uses one clearly illustrative comparison with advertised-price limitations", async () => {
    renderTestApp();
    await screen.findByRole("heading", { name: "Two numbers. A clearer picture." });
    const example = document.getElementById("example");
    if (!example) throw new Error("The example section was not rendered.");
    const figure = within(example).getByRole("figure", {
      name: "Example valuation comparison",
    });

    expect(screen.getAllByRole("figure")).toEqual([figure]);
    expect(figure).toHaveTextContent("$19,000");
    expect(figure).toHaveTextContent("$21,000");
    expect(figure).toHaveTextContent(/example|illustrat/i);
    expect(example).toHaveTextContent(/asking price|advertised price/i);
    expect(example).toHaveTextContent(/settlement/i);
    expect(example).toHaveAttribute("tabindex", "-1");
    for (const removedHeading of [
      "The insurance report may not tell the whole story.",
      "Repairs can fix the vehicle—not its history.",
      "An analysis that makes the evidence clear.",
      "Built for a careful second look.",
    ]) {
      expect(screen.queryByRole("heading", { name: removedHeading })).not.toBeInTheDocument();
    }
  });

  test("places six concise native FAQ disclosures after the example and supports focus and toggling", async () => {
    const user = userEvent.setup();
    renderTestApp();
    await screen.findByRole("heading", { name: "A few things you might be wondering." });
    const faq = document.getElementById("faq");
    const example = document.getElementById("example");
    if (!faq || !example) throw new Error("The example or FAQ section was not rendered.");
    const disclosures = Array.from(faq.querySelectorAll<HTMLDetailsElement>("details"));
    expect(disclosures).toHaveLength(6);
    expect(example.compareDocumentPosition(faq) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const summaries = disclosures.map((details) => {
      const summary = details.querySelector("summary");
      if (!summary) throw new Error("A FAQ answer lacks its native disclosure control.");
      expect(details.firstElementChild).toBe(summary);
      expect(summary).toHaveTextContent(/\?/);
      return summary;
    });

    summaries[0].focus();
    expect(summaries[0]).toHaveFocus();
    await user.tab();
    expect(summaries[1]).toHaveFocus();
    await user.tab({ shift: true });
    expect(summaries[0]).toHaveFocus();

    const answer = disclosures[0].children[1];
    expect(disclosures[0]).not.toHaveAttribute("open");
    expect(answer).not.toBeVisible();
    await user.click(summaries[0]);
    expect(disclosures[0]).toHaveAttribute("open");
    expect(answer).toBeVisible();
    await user.click(summaries[0]);
    expect(disclosures[0]).not.toHaveAttribute("open");
    expect(answer).not.toBeVisible();
  });

  test("answers common questions with current service limits and working recovery routes", async () => {
    const user = userEvent.setup();
    renderTestApp();
    await homepageHero();
    const faq = document.getElementById("faq");
    if (!faq) throw new Error("The FAQ section was not rendered.");
    for (const question of [
      "Do I need an insurance report?",
      "What does Venfour compare?",
      "Does a higher asking price mean a higher settlement?",
      "Will Venfour speak to my insurer?",
      "Can I return to my review later?",
      "Is Diminished Value available?",
    ]) {
      await user.click(within(faq).getByText(question));
    }
    expect(within(faq).getByText(/You can upload your insurer’s valuation report or enter your vehicle and claim details yourself/)).toBeVisible();
    expect(within(faq).getByText(/not a final sale price or a guaranteed settlement/)).toBeVisible();
    expect(within(faq).getByText(/You stay in control of communicating with your insurer/)).toBeVisible();
    expect(within(faq).getByText(/Customer intake is currently paused/)).toBeVisible();
    expect(within(faq).getByRole("link", { name: "review recovery" })).toHaveAttribute("href", "/find-review");
    expect(within(faq).getByRole("link", { name: "view the service update" })).toHaveAttribute("href", "/start?service=diminished-value");
  });

  test("avoids unsupported promises and links the current public policies", async () => {
    renderTestApp();
    await homepageHero();
    expect(screen.queryByRole("heading", { name: "What customers say" })).not.toBeInTheDocument();
    expect(screen.queryByText(/guaranteed increase/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/you are owed/i)).not.toBeInTheDocument();
    for (const href of ["/methodology", "/terms", "/contact"]) {
      expect(document.querySelector(`a[href="${href}"]`)).toBeInTheDocument();
    }
  });

  test("opens the Total Loss start route from the hero action", async () => {
    const user = userEvent.setup();
    const { router } = renderTestApp();
    const hero = await homepageHero();
    await user.click(within(hero).getByRole("link", { name: "Start Total Loss review" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/start"));
    expect(router.state.location.search).toBe("?service=total-loss");
    expect(screen.getByRole("heading", { name: "Start your Total Loss review" })).toBeVisible();
  });

  test("opens the paused Diminished Value update from its service card", async () => {
    const user = userEvent.setup();
    const { router } = renderTestApp();
    await homepageHero();
    const diminishedValue = document.getElementById("diminished-value");
    if (!diminishedValue) throw new Error("The Diminished Value service was not rendered.");
    await user.click(within(diminishedValue).getByRole("link", { name: /service update/i }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/start"));
    expect(router.state.location.search).toBe("?service=diminished-value");
    expect(screen.getByRole("heading", { name: "Diminished Value intake is currently paused" })).toBeVisible();
  });
});
