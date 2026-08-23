import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { AuthService } from "@/features/auth";
import type {
  CustomerProfile,
  CustomerProfileService,
} from "@/features/customer-profile";
import { renderTestApp } from "@/test/render";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-08-23T12:00:00.000Z";

function sessionFor({
  confirmedEmail = true,
  suggestedName = "OAuth Suggested Name",
}: {
  readonly confirmedEmail?: boolean;
  readonly suggestedName?: string;
} = {}): Session {
  return {
    access_token: "access-token",
    expires_in: 3600,
    refresh_token: "refresh-token",
    token_type: "bearer",
    user: {
      app_metadata: {},
      aud: "authenticated",
      created_at: NOW,
      email: "owner@example.com",
      email_confirmed_at: confirmedEmail ? NOW : undefined,
      id: USER_ID,
      user_metadata: { full_name: suggestedName },
    },
  } as Session;
}

function authService(session: Session): AuthService {
  return {
    exchangeCodeForSession: vi.fn(async () => session),
    getSession: vi.fn(async () => session),
    onAuthStateChange: vi.fn(() => () => undefined),
    sendMagicLink: vi.fn(async () => undefined),
    signInWithGoogle: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    verifyEmailOtp: vi.fn(async () => session),
  };
}

function customerProfile(
  overrides: Partial<CustomerProfile> = {},
): CustomerProfile {
  return {
    userId: USER_ID,
    fullName: "Confirmed Customer Name",
    fullNameConfirmedAt: NOW,
    serviceTermsVersion: "2026-08-23",
    serviceTermsAcknowledgedAt: NOW,
    privacyNoticeVersion: "2026-08-23",
    privacyNoticeAcknowledgedAt: NOW,
    operationalFollowUpAllowed: false,
    operationalFollowUpUpdatedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("customer profile gate", () => {
  it("shows verified Auth email read-only and persists a corrected suggestion with separate preferences", async () => {
    const user = userEvent.setup();
    const confirmProfile = vi.fn<CustomerProfileService["confirmProfile"]>(
      async ({ fullName, operationalFollowUpAllowed, userId }) =>
        customerProfile({
          fullName,
          operationalFollowUpAllowed,
          userId,
        }),
    );
    const service: CustomerProfileService = {
      getProfile: vi.fn(async () => null),
      confirmProfile,
    };

    renderTestApp(["/start?service=total-loss"], {
      authService: authService(sessionFor()),
      customerProfileService: service,
    });

    const fullName = await screen.findByLabelText("Full name");
    expect(fullName).toHaveValue("OAuth Suggested Name");
    const email = screen.getByLabelText("Verified email");
    expect(email).toHaveValue("owner@example.com");
    expect(email).toHaveAttribute("readonly");

    await user.clear(fullName);
    await user.type(fullName, "  Corrected   Customer Name  ");
    await user.click(screen.getByRole("checkbox", { name: /Terms of Use/u }));
    await user.click(screen.getByRole("checkbox", { name: /Privacy Policy/u }));
    await user.click(
      screen.getByRole("button", { name: "Confirm and continue" }),
    );

    expect(confirmProfile).toHaveBeenCalledWith({
      userId: USER_ID,
      fullName: "Corrected Customer Name",
      operationalFollowUpAllowed: false,
    });
    expect(confirmProfile.mock.calls[0]?.[0]).not.toHaveProperty("email");
    expect(
      await screen.findByRole("heading", {
        name: "We couldn’t prepare your Total Loss draft",
      }),
    ).toBeVisible();
  });

  it("restores a confirmed server name without allowing OAuth metadata to override it", async () => {
    const service: CustomerProfileService = {
      getProfile: vi.fn(async () => customerProfile()),
      confirmProfile: vi.fn(async () => customerProfile()),
    };

    renderTestApp(["/start?service=total-loss"], {
      authService: authService(
        sessionFor({ suggestedName: "Different OAuth Name" }),
      ),
      customerProfileService: service,
    });

    expect(
      await screen.findByRole("heading", {
        name: "We couldn’t prepare your Total Loss draft",
      }),
    ).toBeVisible();
    expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
    expect(screen.queryByText("Different OAuth Name")).not.toBeInTheDocument();
    expect(service.confirmProfile).not.toHaveBeenCalled();
  });

  it("preserves an existing optional follow-up choice during policy re-confirmation", async () => {
    const user = userEvent.setup();
    const outdatedProfile = customerProfile({
      operationalFollowUpAllowed: true,
      serviceTermsVersion: "2026-08-20",
      privacyNoticeVersion: "2026-08-20",
    });
    const confirmProfile = vi.fn<CustomerProfileService["confirmProfile"]>(
      async () => customerProfile({ operationalFollowUpAllowed: true }),
    );
    const service: CustomerProfileService = {
      getProfile: vi.fn(async () => outdatedProfile),
      confirmProfile,
    };

    renderTestApp(["/start?service=total-loss"], {
      authService: authService(sessionFor()),
      customerProfileService: service,
    });

    expect(
      await screen.findByRole("checkbox", {
        name: /Allow optional operational follow-up/u,
      }),
    ).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: /Terms of Use/u }));
    await user.click(screen.getByRole("checkbox", { name: /Privacy Policy/u }));
    await user.click(
      screen.getByRole("button", { name: "Confirm and continue" }),
    );

    expect(confirmProfile).toHaveBeenCalledWith({
      userId: USER_ID,
      fullName: "Confirmed Customer Name",
      operationalFollowUpAllowed: true,
    });
  });

  it("does not treat an unverified Auth email as a completed profile", async () => {
    const service: CustomerProfileService = {
      getProfile: vi.fn(async () => customerProfile()),
      confirmProfile: vi.fn(async () => customerProfile()),
    };
    const user = userEvent.setup();

    renderTestApp(["/start?service=total-loss"], {
      authService: authService(sessionFor({ confirmedEmail: false })),
      customerProfileService: service,
    });

    expect(await screen.findByLabelText("Verified email")).toHaveValue(
      "Email unavailable",
    );
    await user.click(screen.getByRole("checkbox", { name: /Terms of Use/u }));
    await user.click(screen.getByRole("checkbox", { name: /Privacy Policy/u }));
    await user.click(
      screen.getByRole("button", { name: "Confirm and continue" }),
    );
    expect(
      await screen.findByText(/does not have a verified email/u),
    ).toBeVisible();
    expect(service.confirmProfile).not.toHaveBeenCalled();
  });
});
