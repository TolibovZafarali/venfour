import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test } from "vitest";

import { renderTestApp } from "@/test/render";

describe("homepage structure", () => {
  test("leads with an available review and a truthful paused-service update", () => {
    renderTestApp();

    const heroHeading = screen.getByRole("heading", {
      level: 1,
      name: "Your Vehicle’s Value, Made Clear.",
    });
    expect(heroHeading).toBeVisible();
    expect(heroHeading).toHaveClass(
      "font-hero",
      "font-semibold",
      "leading-[0.98]",
      "tracking-[-0.035em]",
      "text-[2.875rem]",
      "sm:text-[3.25rem]",
      "xl:text-[4.75rem]",
      "2xl:text-[5rem]",
    );
    expect(heroHeading.children).toHaveLength(2);
    expect(heroHeading.children[0]).toHaveTextContent("Your Vehicle’s Value,");
    expect(heroHeading.children[0]).toHaveClass(
      "block",
      "sm:whitespace-nowrap",
    );
    expect(heroHeading.children[1]).toHaveTextContent("Made Clear.");
    expect(heroHeading.children[1]).toHaveClass("block");
    expect(
      screen.getByText(
        "Understand a total-loss vehicle valuation with or without an insurer report. Diminished Value customer intake is currently paused.",
      ),
    ).toBeVisible();
    const hero = heroHeading.closest("section");
    expect(hero).not.toBeNull();
    if (!hero) {
      throw new Error("The homepage hero was not rendered.");
    }
    expect(hero.querySelector("[data-hero-content]")).toHaveClass(
      "min-h-[calc(100svh-4rem)]",
    );
    expect(
      within(hero).getByRole("link", { name: "Start Total Loss review" }),
    ).toHaveAttribute("href", "/start?service=total-loss");
    expect(
      within(hero).getByRole("link", {
        name: "View Diminished Value update",
      }),
    ).toHaveAttribute("href", "/start?service=diminished-value");
    for (const removedLabel of [
      "Total loss",
      "Self-service online",
      "Diminished value",
      "Personally handled",
    ]) {
      expect(within(hero).queryByText(removedLabel)).not.toBeInTheDocument();
    }

    expect(
      within(hero).queryByRole("figure", {
        name: "Example total-loss appraisal",
      }),
    ).not.toBeInTheDocument();
    expect(hero.querySelector("[data-hero-photo]")).toHaveAttribute("alt", "");
    expect(
      hero.querySelector('source[type="image/avif"]'),
    ).toBeInTheDocument();
    expect(hero.querySelector("[data-hero-photo-fade]")).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Vehicle ZIP code")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("form", { name: "Start total-loss appraisal" }),
    ).not.toBeInTheDocument();
  });

  test("presents exactly two truthful services and no general value service", () => {
    renderTestApp();

    const services = document.querySelector<HTMLElement>("#services");
    expect(services).toBeVisible();
    if (!services) {
      throw new Error("The services section was not rendered.");
    }

    expect(services.querySelectorAll("article")).toHaveLength(2);
    const servicesHeading = within(services).getByRole("heading", {
      name: "Two services. Two different situations.",
    });
    expect(servicesHeading).toBeVisible();
    expect(servicesHeading.children).toHaveLength(2);
    for (const line of servicesHeading.children) {
      expect(line).toHaveClass("block");
    }
    expect(
      within(services).getByRole("heading", {
        name: "Your vehicle was totaled",
      }),
    ).toBeVisible();
    expect(
      within(services).getByRole("heading", {
        name: "Your vehicle was repaired",
      }),
    ).toBeVisible();
    expect(
      within(services).getByRole("link", {
        name: "Start Total Loss review",
      }),
    ).toHaveAttribute("href", "/start?service=total-loss");
    expect(
      within(services).getByRole("link", {
        name: "View service update",
      }),
    ).toHaveAttribute("href", "/start?service=diminished-value");
    expect(screen.queryByText("I need my car’s value")).not.toBeInTheDocument();
    expect(screen.queryByText("Request a value check")).not.toBeInTheDocument();
    expect(
      document.querySelector('a[href*="vehicle-value"]'),
    ).not.toBeInTheDocument();
  });

  test("renders the process, educational explanations, deliverable, and trust proof", () => {
    renderTestApp();

    for (const heading of [
      "Start online in a few steps",
      "The insurance report may not tell the whole story.",
      "Repairs can fix the vehicle—not its history.",
      "An analysis that makes the evidence clear.",
      "Built for a careful second look.",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeVisible();
    }

    expect(
      screen.queryByRole("heading", {
        name: "Choose the appraisal that fits your situation.",
      }),
    ).not.toBeInTheDocument();

    const process = document.getElementById("how-it-works");
    expect(process).toBeVisible();
    expect(process?.querySelector("ol")?.children).toHaveLength(3);
    const processVisuals = process?.querySelectorAll("figure") ?? [];
    expect(processVisuals).toHaveLength(3);
    for (const visual of processVisuals) {
      expect(visual).toHaveClass("h-64");
      expect(visual.firstElementChild).toHaveClass("h-44", "max-w-72");
    }
    for (const step of [
      "Add your valuation details",
      "Venfour checks the market",
      "See the evidence review",
    ]) {
      expect(
        within(process as HTMLElement).getByRole("heading", { name: step }),
      ).toBeVisible();
    }
    expect(
      within(process as HTMLElement).getByRole("link", {
        name: "Start Total Loss review",
      }),
    ).toHaveAttribute("href", "/start?service=total-loss");

    expect(
      screen.getByText(
        "A repaired vehicle may sell for less because buyers can see that it was in an accident.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Venfour is completing the Total Loss experience before opening this service to customers.",
      ),
    ).toBeVisible();
    const diminishedValueSection = document.getElementById("diminished-value");
    expect(diminishedValueSection).toBeVisible();
    expect(
      within(diminishedValueSection as HTMLElement).getByRole("link", {
        name: "View Diminished Value update",
      }),
    ).toHaveAttribute("href", "/start?service=diminished-value");
    expect(
      screen.queryByRole("link", { name: "Submit diminished-value request" }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="mailto:"]')).not.toBeInTheDocument();
    for (const proof of [
      "Similar vehicles reviewed",
      "Local market considered",
      "Clear limitations shown",
      "Consumer-friendly explanation",
    ]) {
      expect(screen.getByRole("heading", { name: proof })).toBeVisible();
    }
  });

  test("avoids unsupported promises and links the current public policies", () => {
    renderTestApp();

    expect(
      screen.queryByRole("heading", { name: "What customers say" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/guaranteed increase/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/you are owed/i)).not.toBeInTheDocument();
    for (const href of ["/methodology", "/terms", "/contact"]) {
      expect(document.querySelector(`a[href="${href}"]`)).toBeInTheDocument();
    }
  });

  test("opens the total-loss start route from the hero action", async () => {
    const user = userEvent.setup();
    const { router } = renderTestApp();
    const hero = screen
      .getByRole("heading", {
        name: "Your Vehicle’s Value, Made Clear.",
      })
      .closest("section");
    if (!hero) {
      throw new Error("The homepage hero was not rendered.");
    }

    await user.click(
      within(hero).getByRole("link", { name: "Start Total Loss review" }),
    );

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/start"),
    );
    expect(router.state.location.search).toBe("?service=total-loss");
    expect(
      screen.getByRole("heading", { name: "Start your Total Loss review" }),
    ).toBeVisible();
  });

  test("opens the paused diminished-value service update from the hero action", async () => {
    const user = userEvent.setup();
    const { router } = renderTestApp();
    const hero = screen
      .getByRole("heading", {
        name: "Your Vehicle’s Value, Made Clear.",
      })
      .closest("section");
    if (!hero) {
      throw new Error("The homepage hero was not rendered.");
    }

    await user.click(
      within(hero).getByRole("link", {
        name: "View Diminished Value update",
      }),
    );

    await waitFor(() => expect(router.state.location.pathname).toBe("/start"));
    expect(router.state.location.search).toBe("?service=diminished-value");
    expect(
      screen.getByRole("heading", {
        name: "Diminished Value intake is currently paused",
      }),
    ).toBeVisible();
  });
});
