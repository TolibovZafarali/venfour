import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, test, vi } from "vitest";

import { server } from "@/test/mocks/server";
import { renderTestApp } from "@/test/render";
import { representativeRunId } from "@/test/fixtures/analysis-presentation";

const PDF_CONTENT = "%PDF-1.7\nInsurance value report";

function createPdf(name = "insurance-value-report.pdf") {
  return new File([PDF_CONTENT], name, { type: "application/pdf" });
}

async function fillValidForm(
  user: ReturnType<typeof userEvent.setup>,
  report = createPdf(),
  postalCode = "60611",
) {
  const input = screen.getByLabelText("Insurance value report");
  await user.upload(input, report);
  await user.type(screen.getByLabelText("Vehicle ZIP code"), postalCode);
  return report;
}

function renderReviewApp() {
  return renderTestApp(["/total-loss-review"]);
}

describe("homepage structure", () => {
  test("leads with both appraisal paths and a responsive hero photo", () => {
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
        "Start a total-loss appraisal online or request a diminished value appraisal after repairs.",
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
      within(hero).getByRole("link", { name: "Start total-loss appraisal" }),
    ).toHaveAttribute("href", "/total-loss-review");
    expect(
      within(hero).getByRole("link", {
        name: "Request diminished value appraisal",
      }),
    ).toHaveAttribute("href", "#diminished-value");
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

  test("presents exactly two appraisal services and no general value service", () => {
    renderTestApp();

    const services = document.querySelector<HTMLElement>("#services");
    expect(services).toBeVisible();
    if (!services) {
      throw new Error("The services section was not rendered.");
    }

    expect(services.querySelectorAll("article")).toHaveLength(2);
    const servicesHeading = within(services).getByRole("heading", {
        name: "Two appraisals. Two different situations.",
      });
    expect(servicesHeading).toBeVisible();
    expect(servicesHeading.children).toHaveLength(2);
    for (const line of servicesHeading.children) {
      expect(line).toHaveClass("block");
    }
    expect(
      within(services).getByRole("heading", { name: "Your vehicle was totaled" }),
    ).toBeVisible();
    expect(
      within(services).getByRole("heading", { name: "Your vehicle was repaired" }),
    ).toBeVisible();
    expect(
      within(services).getByRole("link", { name: "Start total-loss appraisal" }),
    ).toHaveAttribute("href", "/total-loss-review");
    expect(
      within(services).getByRole("link", {
        name: "Request diminished value appraisal",
      }),
    ).toHaveAttribute("href", "#diminished-value");
    expect(screen.queryByText("I need my car’s value")).not.toBeInTheDocument();
    expect(screen.queryByText("Request a value check")).not.toBeInTheDocument();
    expect(document.querySelector('a[href*="vehicle-value"]')).not.toBeInTheDocument();
  });

  test("renders the process, educational explanations, deliverable, and trust proof", () => {
    renderTestApp();

    for (const heading of [
      "Start online in a few steps",
      "The insurance report may not tell the whole story.",
      "Repairs can fix the vehicle—not its history.",
      "A report that makes the numbers clear.",
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
      "Upload your insurance report",
      "Venfour checks the market",
      "See the appraisal",
    ]) {
      expect(within(process as HTMLElement).getByRole("heading", { name: step })).toBeVisible();
    }

    expect(
      screen.getByText(
        "A repaired vehicle may sell for less because buyers can see that it was in an accident.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "This service is handled personally. It is not an instant or automated appraisal.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(/Direct requests are temporarily unavailable on this site/i),
    ).toBeVisible();
    for (const proof of [
      "Similar vehicles reviewed",
      "Local market considered",
      "Clear limitations shown",
      "Consumer-friendly explanation",
    ]) {
      expect(screen.getByRole("heading", { name: proof })).toBeVisible();
    }
  });

  test("does not render reviews, unsupported promises, or removed-page links", () => {
    renderTestApp();

    expect(
      screen.queryByRole("heading", { name: "What customers say" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/guaranteed increase/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/you are owed/i)).not.toBeInTheDocument();
    for (const href of ["/methodology", "/terms", "/contact"]) {
      expect(document.querySelector(`a[href="${href}"]`)).not.toBeInTheDocument();
    }
  });

  test("opens the direct upload route from the hero action", async () => {
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
      within(hero).getByRole("link", { name: "Start total-loss appraisal" }),
    );

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/total-loss-review"),
    );
    expect(
      screen.getByRole("heading", { name: "Upload your insurance value report" }),
    ).toBeVisible();
    expect(
      screen.getByRole("form", { name: "Start total-loss appraisal" }),
    ).toBeVisible();
  });
});

describe("dedicated total-loss review", () => {
  test("mounts the provider-neutral upload form directly", () => {
    renderReviewApp();

    expect(
      screen.getByRole("heading", { name: "Upload your insurance value report" }),
    ).toBeVisible();
    expect(document.title).toBe("Start a Total-Loss Appraisal | Venfour");
    expect(screen.getByLabelText("Insurance value report")).toBeVisible();
    expect(screen.getByLabelText("Vehicle ZIP code")).toBeVisible();
    expect(
      screen.getAllByRole("form", { name: "Start total-loss appraisal" }),
    ).toHaveLength(1);
    expect(
      screen.queryByRole("heading", { name: "Which report do you have?" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/CCC/i)).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="/contact"]')).not.toBeInTheDocument();
  });

  test("submits exactly one PDF and one trimmed ZIP as multipart, then opens the returned analysis", async () => {
    const user = userEvent.setup();
    let contentType = "";
    let entries: [string, FormDataEntryValue][] = [];

    server.use(
      http.post("*/api/v1/analyses", async ({ request }) => {
        contentType = request.headers.get("content-type") ?? "";
        const formData = await request.formData();
        entries = Array.from(formData.entries());

        return HttpResponse.json(
          { runId: representativeRunId },
          { status: 201 },
        );
      }),
    );

    const { router } = renderReviewApp();
    const report = await fillValidForm(
      user,
      createPdf("my insurance report.pdf"),
      " 60611 ",
    );
    expect(screen.getByText(report.name)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Start appraisal" }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/analyses/${representativeRunId}`,
      ),
    );
    expect(await screen.findByText("Valuation analysis loaded.")).toBeVisible();
    expect(contentType).toMatch(/^multipart\/form-data;.*boundary=/i);
    expect(entries.map(([name]) => name)).toEqual(["report", "postalCode"]);

    const uploadedReport = entries[0]?.[1];
    expect(uploadedReport).not.toBeTypeOf("string");
    expect(uploadedReport).toMatchObject({ type: "application/pdf" });
    expect((uploadedReport as File).size).toBeGreaterThan(0);
    expect(entries[1]?.[1]).toBe("60611");
  });

  test("accepts and preserves a trimmed ZIP+4", async () => {
    const user = userEvent.setup();
    let submittedPostalCode = "";

    server.use(
      http.post("*/api/v1/analyses", async ({ request }) => {
        const formData = await request.formData();
        submittedPostalCode = String(formData.get("postalCode"));
        return HttpResponse.json(
          { runId: representativeRunId },
          { status: 201 },
        );
      }),
    );

    const { router } = renderReviewApp();
    await fillValidForm(user, createPdf(), " 60611-1234 ");
    await user.click(screen.getByRole("button", { name: "Start appraisal" }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/analyses/${representativeRunId}`,
      ),
    );
    expect(submittedPostalCode).toBe("60611-1234");
  });

  test("accepts a PDF dropped onto the upload target", async () => {
    const user = userEvent.setup();
    const report = createPdf("dropped-report.pdf");
    renderReviewApp();
    fireEvent.drop(screen.getByRole("group", { name: "Insurance report upload" }), {
      dataTransfer: { files: [report] },
    });

    expect(screen.getByText("dropped-report.pdf")).toBeVisible();
    await user.type(screen.getByLabelText("Vehicle ZIP code"), "60611");
    expect(
      screen.getByRole("button", { name: "Start appraisal" }),
    ).toBeEnabled();
  });

  test("accepts a PDF filename with a generic binary MIME type", async () => {
    const user = userEvent.setup();
    renderReviewApp();
    const report = new File([PDF_CONTENT], "browser-report.pdf", {
      type: "application/octet-stream",
    });

    await user.upload(screen.getByLabelText("Insurance value report"), report);

    expect(screen.getByText("browser-report.pdf")).toBeVisible();
    expect(
      screen.queryByText(
        "Choose a PDF version of your insurance value report.",
      ),
    ).not.toBeInTheDocument();
  });

  test("validates required input, PDF type, size, and ZIP before submission", async () => {
    const user = userEvent.setup({ applyAccept: false });
    let requestCount = 0;
    server.use(
      http.post("*/api/v1/analyses", () => {
        requestCount += 1;
        return HttpResponse.json(
          { runId: representativeRunId },
          { status: 201 },
        );
      }),
    );
    renderReviewApp();
    await user.click(screen.getByRole("button", { name: "Start appraisal" }));
    expect(screen.getByText("Choose your insurance value report.")).toBeVisible();
    expect(
      screen.getByText("Enter the ZIP code for the vehicle."),
    ).toBeVisible();

    const fileInput = screen.getByLabelText("Insurance value report");
    await user.upload(
      fileInput,
      new File(["not a PDF"], "report.txt", { type: "text/plain" }),
    );
    expect(
      screen.getByText("Choose a PDF version of your insurance value report."),
    ).toBeVisible();

    await user.upload(
      fileInput,
      new File([PDF_CONTENT], "misidentified.pdf", { type: "text/plain" }),
    );
    expect(
      screen.getByText("Choose a PDF version of your insurance value report."),
    ).toBeVisible();

    fireEvent.drop(screen.getByRole("group", { name: "Insurance report upload" }), {
      dataTransfer: {
        files: [createPdf("first.pdf"), createPdf("second.pdf")],
      },
    });
    expect(
      screen.getByText("Choose one insurance value report PDF at a time."),
    ).toBeVisible();

    const oversizedReport = createPdf("large-report.pdf");
    Object.defineProperty(oversizedReport, "size", {
      configurable: true,
      value: 50 * 1024 * 1024,
    });
    await user.upload(fileInput, oversizedReport);
    expect(screen.getByText("Choose a PDF smaller than 50 MiB.")).toBeVisible();

    await user.upload(fileInput, createPdf());
    await user.type(screen.getByLabelText("Vehicle ZIP code"), "   ");
    await user.click(screen.getByRole("button", { name: "Start appraisal" }));
    expect(
      screen.getByText("Enter the ZIP code for the vehicle."),
    ).toBeVisible();

    await user.clear(screen.getByLabelText("Vehicle ZIP code"));
    await user.type(screen.getByLabelText("Vehicle ZIP code"), "6061A");
    await user.click(screen.getByRole("button", { name: "Start appraisal" }));
    expect(
      screen.getByText(
        "Enter a 5-digit ZIP code or ZIP+4, such as 60611 or 60611-1234.",
      ),
    ).toBeVisible();
    expect(requestCount).toBe(0);
  });

  test("shows one indeterminate processing state and blocks duplicate submission", async () => {
    const user = userEvent.setup();
    let requestCount = 0;
    let releaseRequest: (() => void) | undefined;
    const requestMayFinish = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });

    server.use(
      http.post("*/api/v1/analyses", async () => {
        requestCount += 1;
        await requestMayFinish;
        return HttpResponse.json(
          { runId: representativeRunId },
          { status: 201 },
        );
      }),
    );

    const { router } = renderReviewApp();
    await fillValidForm(user);
    const submitButton = screen.getByRole("button", {
      name: "Start appraisal",
    });
    const form = screen.getByRole("form", {
      name: "Start total-loss appraisal",
    });

    fireEvent.submit(form);
    fireEvent.submit(form);
    try {
      const processingStatus = await screen.findByRole("status", {
        name: "Analysis in progress",
      });
      expect(processingStatus).toHaveTextContent(
        "Preparing your total-loss appraisal",
      );
      expect(processingStatus).toHaveTextContent("reading the insurance report");
      expect(processingStatus).toHaveTextContent(
        "reviewing relevant market evidence",
      );
      expect(processingStatus).toHaveTextContent("This can take a few minutes");
      expect(submitButton).toBeDisabled();
      expect(screen.getByLabelText("Insurance value report")).toBeDisabled();
      expect(screen.getByLabelText("Vehicle ZIP code")).toBeDisabled();
      await waitFor(() => expect(requestCount).toBe(1));
    } finally {
      releaseRequest?.();
    }

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/analyses/${representativeRunId}`,
      ),
    );
  });

  test.each([
    ["INVALID_REPORT", 400, "Choose a valid PDF"],
    ["REPORT_TOO_LARGE", 413, "Your report is too large"],
    ["REPORT_EXTRACTION_FAILED", 502, "We couldn’t read this report"],
    ["REPORT_NOT_ANALYZABLE", 422, "This report couldn’t be analyzed"],
    ["INVALID_POSTAL_CODE", 400, "Check the ZIP code"],
    [
      "MARKET_PROVIDER_UNAVAILABLE",
      503,
      "Market search is temporarily unavailable",
    ],
    [
      "ANALYSIS_CREATION_UNAVAILABLE",
      503,
      "Analysis is temporarily unavailable",
    ],
    ["ANALYSIS_CREATION_FAILED", 500, "Venfour couldn’t complete this review"],
  ])("maps %s to a customer-safe error", async (code, status, title) => {
    const user = userEvent.setup();
    server.use(
      http.post("*/api/v1/analyses", () =>
        HttpResponse.json(
          {
            error: {
              code,
              message: "Internal extraction/provider detail must stay hidden.",
            },
          },
          { status },
        ),
      ),
    );
    renderReviewApp();
    await fillValidForm(user);

    await user.click(screen.getByRole("button", { name: "Start appraisal" }));

    expect(await screen.findByText(title)).toBeVisible();
    expect(
      screen.queryByText(
        "Internal extraction/provider detail must stay hidden.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(code)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  test("distinguishes an offline failure without clearing the form", async () => {
    const user = userEvent.setup();
    const onlineState = vi
      .spyOn(window.navigator, "onLine", "get")
      .mockReturnValue(false);

    server.use(http.post("*/api/v1/analyses", () => HttpResponse.error()));
    renderReviewApp();
    await fillValidForm(user, createPdf("offline-report.pdf"), "60611");

    try {
      await user.click(
        screen.getByRole("button", { name: "Start appraisal" }),
      );

      expect(await screen.findByText("You appear to be offline")).toBeVisible();
      expect(screen.getByText("offline-report.pdf")).toBeVisible();
      expect(screen.getByLabelText("Vehicle ZIP code")).toHaveValue("60611");
      expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    } finally {
      onlineState.mockRestore();
    }
  });

  test("discloses third-party processing beside the submission action", () => {
    renderReviewApp();

    expect(
      screen.getByText(/uses third-party services to process your report/i),
    ).toBeVisible();
    expect(
      screen.getByText(/Do not upload documents you are not authorized to share/i),
    ).toBeVisible();
    expect(document.querySelector('a[href="/privacy"]')).toBeInTheDocument();
  });

  test("retries with the same valid report and ZIP without asking for reselection", async () => {
    const user = userEvent.setup();
    const submissions: { reportType: string; postalCode: string }[] = [];

    server.use(
      http.post("*/api/v1/analyses", async ({ request }) => {
        const formData = await request.formData();
        const report = formData.get("report");
        submissions.push({
          reportType: report && typeof report !== "string" ? report.type : "",
          postalCode: String(formData.get("postalCode")),
        });

        if (submissions.length === 1) {
          return HttpResponse.json(
            {
              error: {
                code: "MARKET_PROVIDER_UNAVAILABLE",
                message: "Provider request failed.",
              },
            },
            { status: 503 },
          );
        }

        return HttpResponse.json(
          { runId: representativeRunId },
          { status: 201 },
        );
      }),
    );

    const { router } = renderReviewApp();
    await fillValidForm(user, createPdf("retained-report.pdf"), "60611");
    await user.click(screen.getByRole("button", { name: "Start appraisal" }));

    expect(
      await screen.findByText("Market search is temporarily unavailable"),
    ).toBeVisible();
    expect(screen.getByText("retained-report.pdf")).toBeVisible();
    expect(screen.getByLabelText("Vehicle ZIP code")).toHaveValue("60611");

    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/analyses/${representativeRunId}`,
      ),
    );
    expect(submissions).toEqual([
      { reportType: "application/pdf", postalCode: "60611" },
      { reportType: "application/pdf", postalCode: "60611" },
    ]);
  });
});
