import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, test, vi } from "vitest";

import { server } from "@/test/mocks/server";
import { renderTestApp } from "@/test/render";
import { representativeRunId } from "@/test/fixtures/analysis-presentation";

const PDF_CONTENT = "%PDF-1.7\nCCC valuation report";

function createPdf(name = "ccc-valuation.pdf") {
  return new File([PDF_CONTENT], name, { type: "application/pdf" });
}

async function fillValidForm(
  user: ReturnType<typeof userEvent.setup>,
  report = createPdf(),
  postalCode = "60611",
) {
  if (!screen.queryByRole("form", { name: "Start valuation analysis" })) {
    await user.click(
      screen.getByRole("button", {
        name: /CCC valuation report.*Choose CCC report/i,
      }),
    );
  }

  const input = screen.getByLabelText("CCC valuation report");
  await user.upload(input, report);
  await user.type(screen.getByLabelText("Vehicle ZIP code"), postalCode);
  return report;
}

function renderReviewApp() {
  if (typeof HTMLElement.prototype.scrollIntoView !== "function") {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  }

  return renderTestApp(["/total-loss-review"]);
}

async function chooseCccReport(user: ReturnType<typeof userEvent.setup>) {
  expect(
    screen.queryByRole("form", { name: "Start valuation analysis" }),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", {
      name: /CCC valuation report.*Choose CCC report/i,
    }),
  );
  expect(
    screen.getByRole("form", { name: "Start valuation analysis" }),
  ).toBeVisible();
}

describe("homepage structure", () => {
  test("explains the service, presents a real example, and has no entry form", () => {
    renderTestApp();

    const heroHeading = screen.getByRole("heading", {
      level: 1,
      name: "Understand your vehicle’s value after an accident.",
    });
    expect(heroHeading).toBeVisible();
    expect(
      screen.getByText(
        "Review a total-loss valuation, check market value, or request diminished-value help.",
      ),
    ).toBeVisible();
    const hero = heroHeading.closest("section");
    expect(hero).not.toBeNull();
    if (!hero) {
      throw new Error("The homepage hero was not rendered.");
    }
    expect(within(hero).getByRole("link", { name: "Get started" })).toHaveAttribute(
      "href",
      "#services",
    );
    expect(within(hero).getByRole("link", { name: "How it works" })).toHaveAttribute(
      "href",
      "#how-it-works",
    );
    expect(
      screen.getByRole("heading", { name: "Anonymized sample vehicle" }),
    ).toBeVisible();
    expect(screen.getByText("Example analysis")).toBeVisible();
    expect(
      screen.getByRole("figure", {
        name: /insurer valuation \$20,000.*selected advertised-price range \$21,800 to \$22,600.*median advertised price \$22,200/i,
      }),
    ).toBeVisible();

    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Vehicle ZIP code")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("form", { name: "Start valuation analysis" }),
    ).not.toBeInTheDocument();
  });

  test("presents all three service choices with honest destinations", () => {
    renderTestApp();

    const servicePaths = document.querySelector<HTMLElement>("#services");
    expect(servicePaths).toBeVisible();
    if (!servicePaths) {
      throw new Error("The services section was not rendered.");
    }

    const paths = within(servicePaths);
    for (const heading of [
      "Review a total-loss valuation",
      "Check my vehicle’s value",
      "Get diminished-value help",
    ]) {
      expect(paths.getByRole("heading", { name: heading })).toBeVisible();
    }

    expect(
      paths.getByRole("link", {
        name: /Review a total-loss valuation.*Review my valuation/i,
      }),
    ).toHaveAttribute("href", "/total-loss-review");
    expect(
      paths.getByRole("link", {
        name: /Check my vehicle.s value.*Request a value check/i,
      }),
    ).toHaveAttribute("href", "/contact?topic=vehicle-value");
    expect(
      paths.getByRole("link", {
        name: /Get diminished-value help.*Request a review/i,
      }),
    ).toHaveAttribute("href", "/contact?topic=diminished-value");
  });

  test("summarizes the method and links to the detailed methodology", () => {
    renderTestApp();

    const howItWorks = document.querySelector<HTMLElement>("#how-it-works");
    expect(howItWorks).toBeVisible();
    if (!howItWorks) {
      throw new Error("The how-it-works section was not rendered.");
    }

    const process = within(howItWorks);
    for (const heading of [
      "Choose what you need",
      "Provide the details",
      "Review the evidence",
    ]) {
      expect(process.getByRole("heading", { name: heading })).toBeVisible();
    }

    expect(
      screen.getByRole("heading", { name: "Built around market evidence" }),
    ).toBeVisible();

    expect(
      screen.getByRole("link", { name: "See our methodology" }),
    ).toHaveAttribute("href", "/methodology");
  });

  test("opens the dedicated review route from the report service", async () => {
    const user = userEvent.setup();
    const { router } = renderTestApp();

    await user.click(
      screen.getByRole("link", {
        name: /Review a total-loss valuation.*Review my valuation/i,
      }),
    );

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/total-loss-review"),
    );
    expect(
      screen.getByRole("heading", { name: "Review your total-loss valuation" }),
    ).toBeVisible();
  });
});

describe("dedicated total-loss review", () => {
  test("requires a CCC choice before mounting the automated form", async () => {
    const user = userEvent.setup();
    renderReviewApp();

    expect(
      screen.getByRole("heading", { name: "Which report do you have?" }),
    ).toBeVisible();
    expect(document.title).toBe("Total-Loss Valuation Review | Venfour");
    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Vehicle ZIP code")).not.toBeInTheDocument();

    await chooseCccReport(user);

    expect(screen.getByLabelText("CCC valuation report")).toBeVisible();
    expect(screen.getByLabelText("Vehicle ZIP code")).toBeVisible();
    expect(
      screen.getAllByRole("form", { name: "Start valuation analysis" }),
    ).toHaveLength(1);
  });

  test("routes unsupported or uncertain reports to help without mounting the form", async () => {
    const user = userEvent.setup();
    const { router } = renderReviewApp();

    await user.click(
      screen.getByRole("link", {
        name: /Another report or not sure.*Request help/i,
      }),
    );

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/contact");
      expect(router.state.location.search).toBe("?topic=report-format");
    });
    expect(
      screen.getByRole("heading", { name: "Ask about another valuation report" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("form", { name: "Start valuation analysis" }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument();
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
      createPdf("my ccc report.pdf"),
      " 60611 ",
    );
    expect(screen.getByText(report.name)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Analyze my report" }));

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
    await user.click(screen.getByRole("button", { name: "Analyze my report" }));

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
    await chooseCccReport(user);

    fireEvent.drop(screen.getByRole("group", { name: "CCC report upload" }), {
      dataTransfer: { files: [report] },
    });

    expect(screen.getByText("dropped-report.pdf")).toBeVisible();
    await user.type(screen.getByLabelText("Vehicle ZIP code"), "60611");
    expect(
      screen.getByRole("button", { name: "Analyze my report" }),
    ).toBeEnabled();
  });

  test("accepts a PDF filename with a generic binary MIME type", async () => {
    const user = userEvent.setup();
    renderReviewApp();
    await chooseCccReport(user);
    const report = new File([PDF_CONTENT], "browser-report.pdf", {
      type: "application/octet-stream",
    });

    await user.upload(screen.getByLabelText("CCC valuation report"), report);

    expect(screen.getByText("browser-report.pdf")).toBeVisible();
    expect(
      screen.queryByText("Choose a PDF version of your CCC valuation report."),
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
    await chooseCccReport(user);

    await user.click(screen.getByRole("button", { name: "Analyze my report" }));
    expect(screen.getByText("Choose your CCC valuation report.")).toBeVisible();
    expect(
      screen.getByText("Enter the ZIP code for the vehicle."),
    ).toBeVisible();

    const fileInput = screen.getByLabelText("CCC valuation report");
    await user.upload(
      fileInput,
      new File(["not a PDF"], "report.txt", { type: "text/plain" }),
    );
    expect(
      screen.getByText("Choose a PDF version of your CCC valuation report."),
    ).toBeVisible();

    await user.upload(
      fileInput,
      new File([PDF_CONTENT], "misidentified.pdf", { type: "text/plain" }),
    );
    expect(
      screen.getByText("Choose a PDF version of your CCC valuation report."),
    ).toBeVisible();

    fireEvent.drop(screen.getByRole("group", { name: "CCC report upload" }), {
      dataTransfer: {
        files: [createPdf("first.pdf"), createPdf("second.pdf")],
      },
    });
    expect(
      screen.getByText("Choose one CCC valuation PDF at a time."),
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
    await user.click(screen.getByRole("button", { name: "Analyze my report" }));
    expect(
      screen.getByText("Enter the ZIP code for the vehicle."),
    ).toBeVisible();

    await user.clear(screen.getByLabelText("Vehicle ZIP code"));
    await user.type(screen.getByLabelText("Vehicle ZIP code"), "6061A");
    await user.click(screen.getByRole("button", { name: "Analyze my report" }));
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
      name: "Analyze my report",
    });
    const form = screen.getByRole("form", {
      name: "Start valuation analysis",
    });

    fireEvent.submit(form);
    fireEvent.submit(form);
    try {
      const processingStatus = await screen.findByRole("status", {
        name: "Analysis in progress",
      });
      expect(processingStatus).toHaveTextContent(
        "Preparing your valuation review",
      );
      expect(processingStatus).toHaveTextContent("reading the CCC report");
      expect(processingStatus).toHaveTextContent(
        "reviewing relevant market evidence",
      );
      expect(processingStatus).toHaveTextContent("This can take a few minutes");
      expect(submitButton).toBeDisabled();
      expect(screen.getByLabelText("CCC valuation report")).toBeDisabled();
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
    ["INVALID_REPORT", 400, "Choose a valid CCC PDF"],
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

    await user.click(screen.getByRole("button", { name: "Analyze my report" }));

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
        screen.getByRole("button", { name: "Analyze my report" }),
      );

      expect(await screen.findByText("You appear to be offline")).toBeVisible();
      expect(screen.getByText("offline-report.pdf")).toBeVisible();
      expect(screen.getByLabelText("Vehicle ZIP code")).toHaveValue("60611");
      expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    } finally {
      onlineState.mockRestore();
    }
  });

  test("discloses third-party processing beside the submission action", async () => {
    const user = userEvent.setup();
    renderReviewApp();
    await chooseCccReport(user);

    expect(
      screen.getByText(/uses third-party services to process your report/i),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Privacy Policy" }),
    ).toHaveAttribute("href", "/privacy");
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
    await user.click(screen.getByRole("button", { name: "Analyze my report" }));

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
