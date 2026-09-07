import type { Session } from "@supabase/supabase-js";

export function appleSession(email = "owner@example.com"): Session {
  const userId = "11111111-1111-4111-8111-111111111111";
  const metadata = {
    iss: "https://appleid.apple.com",
    sub: "apple-test-subject",
    provider_id: "apple-test-subject",
    email,
    email_verified: true,
    phone_verified: false,
    custom_claims: {
      is_private_email: email.endsWith("@privaterelay.appleid.com"),
    },
  };
  return {
    access_token: "apple-test-access-token",
    refresh_token: "apple-test-refresh-token",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user: {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      created_at: "2026-09-07T00:00:00Z",
      email,
      email_confirmed_at: "2026-09-07T00:00:00Z",
      is_anonymous: false,
      app_metadata: { provider: "apple", providers: ["apple"] },
      user_metadata: metadata,
      identities: [
        {
          id: "apple-test-subject",
          identity_id: "22222222-2222-4222-8222-222222222222",
          user_id: userId,
          provider: "apple",
          identity_data: metadata,
        },
      ],
    },
  };
}
