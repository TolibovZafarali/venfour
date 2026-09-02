import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import {
  AppraisalCasesEmptyState,
  AppraisalCasesErrorState,
  AppraisalCasesLoadingState,
} from "@/features/cases/appraisal-case-list-states";

describe("appraisal case list states", () => {
  it("renders the appraisal-list loading state", () => {
    render(<AppraisalCasesLoadingState />);

    expect(screen.getByLabelText("Loading appraisals")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("renders configured error actions", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(
      <MemoryRouter>
        <AppraisalCasesErrorState
          heading="Appraisals unavailable"
          description="The saved list could not be verified."
          onRetry={onRetry}
          showContactSupport
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Contact support" })).toHaveAttribute(
      "href",
      "/contact",
    );
  });

  it("keeps the compact empty state informational", () => {
    render(
      <AppraisalCasesEmptyState
        description="Saved appraisals will appear here."
      />,
    );

    expect(
      screen.getByRole("heading", { name: "No appraisals yet" }),
    ).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

});
