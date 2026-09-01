import { describe, expect, it, vi } from "vitest";

import {
  buildTotalLossMailto,
  formatCommercePrice,
  openPublishedReport,
  reservePublishedReportPreview,
} from "@/features/total-loss-claim/browser-actions";

describe("total-loss email and price browser actions", () => {
  it("encodes a standards-compliant mailto without pretending to attach a report", () => {
    const mailto = buildTotalLossMailto({
      recipient: "adjuster+claims@example.com",
      subject: "Claim 42 — valuation review",
      body: "Hello,\n\nPlease review the attached report & reply in writing.",
    });
    const parsed = new URL(mailto);

    expect(parsed.protocol).toBe("mailto:");
    expect(decodeURIComponent(parsed.pathname)).toBe(
      "adjuster+claims@example.com",
    );
    expect(parsed.searchParams.get("subject")).toBe(
      "Claim 42 — valuation review",
    );
    expect(parsed.searchParams.get("body")).toContain(
      "Please review the attached report & reply in writing.",
    );
    expect(mailto).not.toMatch(/attach(?:ment)?=/iu);
  });

  it("formats only a server-provided amount and currency", () => {
    expect(formatCommercePrice(12900, "USD", null)).toMatch(/129\.00/u);
    expect(formatCommercePrice(null, null, null)).toBeNull();
    expect(formatCommercePrice(null, null, "Server unavailable")).toBe(
      "Server unavailable",
    );
  });

  it("removes only signed download disposition for preview", () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const signedUrl =
      "https://storage.example.test/report.pdf?token=signed%2Bvalue&download=Vehicle_Valuation_Report.pdf&expires=1788030000";

    openPublishedReport(signedUrl, "Vehicle_Valuation_Report.pdf", true);
    const previewAnchor = click.mock.instances.at(-1) as HTMLAnchorElement;
    const previewUrl = new URL(previewAnchor.href);

    expect(previewUrl.origin).toBe("https://storage.example.test");
    expect(previewUrl.pathname).toBe("/report.pdf");
    expect(previewUrl.searchParams.get("token")).toBe("signed+value");
    expect(previewUrl.searchParams.get("expires")).toBe("1788030000");
    expect(previewUrl.searchParams.has("download")).toBe(false);
    expect(previewAnchor.target).toBe("_blank");

    openPublishedReport(signedUrl, "Vehicle_Valuation_Report.pdf", false);
    const downloadAnchor = click.mock.instances.at(-1) as HTMLAnchorElement;
    expect(new URL(downloadAnchor.href).searchParams.get("download")).toBe(
      "Vehicle_Valuation_Report.pdf",
    );
    expect(downloadAnchor.download).toBe("Vehicle_Valuation_Report.pdf");

    click.mockRestore();
  });

  it("reserves a user-initiated window before asynchronously opening a preview", () => {
    const replace = vi.fn();
    const previewWindow = {
      closed: false,
      location: { replace },
      opener: window,
    } as unknown as Window;
    const opened = vi.spyOn(window, "open").mockReturnValue(previewWindow);
    const reserved = reservePublishedReportPreview();

    expect(opened).toHaveBeenCalledWith("about:blank", "_blank");
    expect(previewWindow.opener).toBeNull();
    openPublishedReport(
      "https://storage.example.test/report.pdf?token=signed&download=Vehicle_Valuation_Report.pdf",
      "Vehicle_Valuation_Report.pdf",
      true,
      reserved,
    );
    expect(replace).toHaveBeenCalledWith(
      "https://storage.example.test/report.pdf?token=signed",
    );
  });
});
