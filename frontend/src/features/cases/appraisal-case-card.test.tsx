import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { AppraisalCaseCard } from "@/features/cases/appraisal-case-card";
import { formatAppraisalCaseLastActivity } from "@/features/cases/format";
import type { AppraisalCase } from "@/features/cases/types";

const appraisalCase: AppraisalCase = {
  id: "22222222-2222-4222-8222-222222222222",
  userId: "11111111-1111-4111-8111-111111111111",
  serviceType: "total_loss",
  status: "draft",
  createdAt: "2026-08-20T12:00:00.000Z",
  updatedAt: "2026-08-22T15:00:00.000Z",
  lastActivityAt: "2026-08-22T15:00:00.000Z",
};

describe("appraisal case card", () => {
  it("renders with the requested heading level and authoritative action", () => {
    render(
      <MemoryRouter>
        <AppraisalCaseCard appraisalCase={appraisalCase} headingLevel={3} />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { level: 3, name: "Total-loss review" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Continue review" })).toHaveAttribute(
      "href",
      `/start?service=total-loss&view=intake&caseId=${appraisalCase.id}`,
    );
  });

  it("uses an h2 by default", () => {
    render(
      <MemoryRouter>
        <AppraisalCaseCard appraisalCase={appraisalCase} />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Total-loss review" }),
    ).toBeVisible();
  });
});

describe("appraisal case last activity formatting", () => {
  it("returns a safe label for an invalid timestamp", () => {
    expect(formatAppraisalCaseLastActivity("not-a-timestamp")).toBe(
      "Update time unavailable",
    );
  });

  it("formats a valid timestamp as an update", () => {
    expect(
      formatAppraisalCaseLastActivity(appraisalCase.lastActivityAt),
    ).toMatch(/^Updated /);
  });
});
