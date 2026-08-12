import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, test } from "vitest";

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
  const input = screen.getByLabelText("CCC valuation report");
  await user.upload(input, report);
  await user.type(screen.getByLabelText("Vehicle ZIP code"), postalCode);
  return report;
}

describe("analysis creation", () => {
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

    const { router } = renderTestApp();
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

  test("accepts a PDF dropped onto the upload target", async () => {
    const user = userEvent.setup();
    const report = createPdf("dropped-report.pdf");
    renderTestApp();

    fireEvent.drop(screen.getByRole("group", { name: "CCC report upload" }), {
      dataTransfer: { files: [report] },
    });

    expect(screen.getByText("dropped-report.pdf")).toBeVisible();
    await user.type(screen.getByLabelText("Vehicle ZIP code"), "60611");
    expect(
      screen.getByRole("button", { name: "Analyze my report" }),
    ).toBeEnabled();
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
    renderTestApp();

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

    const { router } = renderTestApp();
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
      expect(processingStatus).toHaveTextContent("Analyzing your report");
      expect(processingStatus).toHaveTextContent("retrieving market evidence");
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
    ["ANALYSIS_CREATION_FAILED", 500, "We couldn’t create your review"],
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
    renderTestApp();
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

    const { router } = renderTestApp();
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
