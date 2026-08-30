import { createClient } from "@supabase/supabase-js";
import type { Session, SupabaseClient } from "@supabase/supabase-js";

import { environment } from "@/config/env";
import type { CompleteTotalLossIdentityClaimResult } from "@/features/total-loss/data-types";
import {
  createTotalLossIdentityService,
  TotalLossIdentityResponseError,
} from "@/features/total-loss/identity-service";
import {
  canInstallSessionForAnonymousOwner,
  installSessionForAnonymousOwner,
  supabaseClientState,
} from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import { SessionInstallationIdentityError } from "@/lib/supabase/guarded-session-storage";

export type ClaimEmailOtpErrorCode =
  | "invalid_code"
  | "expired_code"
  | "rate_limited"
  | "claim_conflict"
  | "identity_changed"
  | "session_install_failed"
  | "request_failed"
  | "aborted"
  | "busy";

export class ClaimEmailOtpError extends Error {
  readonly code: ClaimEmailOtpErrorCode;

  constructor(code: ClaimEmailOtpErrorCode) {
    super(`Claim email verification could not complete (${code}).`);
    this.name = "ClaimEmailOtpError";
    this.code = code;
  }
}

interface ClaimEmailOtpScope {
  caseId: string;
  email: string;
  expectedUserId: string;
  signal?: AbortSignal;
}

interface VerifyClaimEmailOtpInput extends ClaimEmailOtpScope {
  claimId: string;
  token: string;
}

export interface ClaimEmailOtpService {
  sendCode(input: ClaimEmailOtpScope & { captchaToken: string }): Promise<void>;
  verifyCodeAndClaim(
    input: VerifyClaimEmailOtpInput,
  ): Promise<CompleteTotalLossIdentityClaimResult>;
  clearPendingVerification(): void;
}

interface ClaimEmailOtpDependencies {
  mainClient: SupabaseClient<Database>;
  createIsolatedClient: () => SupabaseClient<Database>;
  origin: () => string;
  installSession?: typeof installSessionForAnonymousOwner;
}

interface PendingVerification {
  caseId: string;
  claimId: string;
  email: string;
  expectedUserId: string;
  session: Session;
  client: SupabaseClient<Database>;
  expiresAt: number;
}

const PENDING_VERIFICATION_LIFETIME_MS = 5 * 60 * 1_000;
let isolatedClientSequence = 0;

export function createIsolatedClaimEmailClient(
  url: string,
  publishableKey: string,
) {
  isolatedClientSequence += 1;
  return createClient<Database>(url, publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: "implicit",
      debug: false,
      storageKey: `venfour.claim-email-otp.${isolatedClientSequence}`,
    },
  });
}

export function createClaimEmailOtpService({
  mainClient,
  createIsolatedClient,
  origin,
  installSession = installSessionForAnonymousOwner,
}: ClaimEmailOtpDependencies): ClaimEmailOtpService {
  let busy = false;
  let pending: PendingVerification | null = null;
  let generation = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let idleSubscription: { unsubscribe(): void } | null = null;
  let idleWatchVersion = 0;
  let retiredPending: (Pick<PendingVerification, "caseId" | "claimId" | "email" | "expectedUserId"> & {
    code: "expired_code" | "identity_changed";
  }) | null = null;

  function stopIdleWatch() {
    idleWatchVersion += 1;
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = null;
    idleSubscription?.unsubscribe();
    idleSubscription = null;
  }

  function retirePending(code: "expired_code" | "identity_changed") {
    stopIdleWatch();
    if (!pending) return;
    const { caseId, claimId, email, expectedUserId, client } = pending;
    retiredPending = { caseId, claimId, email, expectedUserId, code };
    pending = null;
    disposeClient(client);
  }

  function watchIdlePending() {
    stopIdleWatch();
    const idlePending = pending;
    if (!idlePending) return;
    const watchVersion = idleWatchVersion;
    idleTimer = setTimeout(() => {
      if (watchVersion === idleWatchVersion) retirePending("expired_code");
    },
      Math.max(0, idlePending.expiresAt - Date.now()));
    const { data: { subscription } } = mainClient.auth.onAuthStateChange((_event, session) => {
      if (watchVersion === idleWatchVersion && pending === idlePending &&
        (session?.user.id !== idlePending.expectedUserId ||
        session.user.is_anonymous !== true)) retirePending("identity_changed");
    });
    if (pending === idlePending) idleSubscription = subscription;
    else subscription.unsubscribe();
  }

  function clearPendingVerification() {
    generation += 1;
    stopIdleWatch();
    retiredPending = null;
    const client = pending?.client;
    pending = null;
    if (client) disposeClient(client);
  }

  function startOperation(input: ClaimEmailOtpScope) {
    if (busy) throw new ClaimEmailOtpError("busy");
    stopIdleWatch();
    busy = true;
    const operationGeneration = generation;
    const guard = createIdentityGuard(mainClient, input, () => {
      if (operationGeneration !== generation) {
        throw new ClaimEmailOtpError("aborted");
      }
    });
    return {
      guard,
      finish() {
        guard.unsubscribe();
        busy = false;
        watchIdlePending();
      },
    };
  }

  return {
    clearPendingVerification,

    async sendCode(input) {
      if (busy) throw new ClaimEmailOtpError("busy");
      clearPendingVerification();
      const operation = startOperation(input);
      let client: SupabaseClient<Database> | undefined;
      try {
        await operation.guard.assertAnonymousOwner();
        client = createIsolatedClient();
        const { error } = await client.auth.signInWithOtp({
          email: input.email,
          options: {
            captchaToken: input.captchaToken,
            shouldCreateUser: true,
            emailRedirectTo: `${origin()}/total-loss/cases/${encodeURIComponent(input.caseId)}/claim/checkout`,
          },
        });
        await operation.guard.assertAnonymousOwner();
        if (error) throw authError(error);
      } catch (error) {
        operation.guard.assertUnchanged();
        throw safeError(error);
      } finally {
        if (client) disposeClient(client);
        operation.finish();
      }
    },

    async verifyCodeAndClaim(input) {
      if (input.token === "" && retiredPending && pendingMatches(retiredPending, input)) {
        throw new ClaimEmailOtpError(retiredPending.code);
      }
      const pendingRetry = input.token === "" && pending !== null && pendingMatches(pending, input);
      if (!pendingRetry && (input.token.length !== 6 || !/^\d{6}$/.test(input.token))) {
        throw new ClaimEmailOtpError("invalid_code");
      }
      const operation = startOperation(input);
      retiredPending = null;
      let client: SupabaseClient<Database> | undefined;
      try {
        await operation.guard.assertAnonymousOwner();
        if (pending && !pendingMatches(pending, input)) {
          const previousClient = pending.client;
          pending = null;
          disposeClient(previousClient);
        }
        if (pending && pending.expiresAt <= Date.now()) {
          const expiredClient = pending.client;
          pending = null;
          disposeClient(expiredClient);
          throw new ClaimEmailOtpError("expired_code");
        }
        client = pending?.client ?? createIsolatedClient();
        if (!pending) {
          const { data, error } = await client.auth.verifyOtp({
            email: input.email,
            token: input.token,
            type: "email",
          });
          await operation.guard.assertAnonymousOwner();
          if (error) throw authError(error);
          const session = data.session;
          assertVerifiedSession(session, input.email);
          pending = {
            caseId: input.caseId,
            claimId: input.claimId,
            email: input.email,
            expectedUserId: input.expectedUserId,
            session,
            client,
            expiresAt: Math.min(
              Date.now() + PENDING_VERIFICATION_LIFETIME_MS,
              session.expires_at ? session.expires_at * 1_000 : Infinity,
            ),
          };
        }

        const session = pending.session;
        await operation.guard.assertAnonymousOwner();
        let completed: CompleteTotalLossIdentityClaimResult | void;
        try {
          completed = await createTotalLossIdentityService(client)
            .completeIdentityClaim(input.claimId);
        } catch (error) {
          const safe = claimError(error);
          throw safe.code === "request_failed"
            ? new ClaimEmailOtpError("session_install_failed")
            : safe;
        }
        assertCompletedClaim(completed, input, session);
        await operation.guard.assertAnonymousOwner();
        operation.guard.beginInstallation(session);
        let installedSession: Session | null;
        try {
          const { data, error } = await installSession(
            mainClient, session, input.expectedUserId, operation.guard.assertUnchanged,
          );
          if (error) throw error;
          installedSession = data.session;
        } catch (error) {
          operation.guard.assertUnchanged();
          if (error instanceof SessionInstallationIdentityError) {
            throw new ClaimEmailOtpError("identity_changed");
          }
          throw new ClaimEmailOtpError("session_install_failed");
        }
        operation.guard.assertUnchanged();
        assertVerifiedSession(installedSession, input.email);
        if (installedSession.user.id !== session.user.id) {
          throw new ClaimEmailOtpError("identity_changed");
        }
        await operation.guard.assertInstalledOwner(session);
        pending = null;
        return completed;
      } catch (error) {
        let safe = safeError(error);
        try {
          operation.guard.assertUnchanged();
        } catch (guardError) {
          safe = safeError(guardError);
        }
        if (safe.code !== "session_install_failed" && safe.code !== "request_failed") {
          if (pending && pending.client !== client) disposeClient(pending.client);
          pending = null;
        }
        throw safe;
      } finally {
        if (client && client !== pending?.client) disposeClient(client);
        operation.finish();
      }
    },
  };
}

function createIdentityGuard(
  client: SupabaseClient<Database>,
  input: ClaimEmailOtpScope,
  assertGeneration: () => void,
) {
  let identityChanged = false;
  let installingSession: Session | null = null;
  let installationPublished = false;
  const matchesGuest = (session: Session | null) =>
    session?.user.id === input.expectedUserId && session.user.is_anonymous === true;
  const matchesInstallation = (session: Session | null) =>
    installingSession !== null &&
    session?.user.id === installingSession.user.id &&
    session.user.is_anonymous === false &&
    normalizedEmail(session.user.email) === normalizedEmail(input.email);
  const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && matchesInstallation(session) &&
      session?.access_token === installingSession?.access_token &&
      session?.refresh_token === installingSession?.refresh_token) {
      installationPublished = true;
    }
    if (!matchesGuest(session) && !matchesInstallation(session)) identityChanged = true;
  });

  function assertUnchanged() {
    assertGeneration();
    // Publishing the verified session can unmount and abort the old guest panel.
    if (input.signal?.aborted && !installationPublished) throw new ClaimEmailOtpError("aborted");
    if (identityChanged) throw new ClaimEmailOtpError("identity_changed");
  }

  return {
    assertUnchanged,
    unsubscribe: () => subscription.unsubscribe(),
    async assertAnonymousOwner() {
      assertUnchanged();
      const { data, error } = await client.auth.getSession();
      assertUnchanged();
      if (error || !matchesGuest(data.session)) {
        throw new ClaimEmailOtpError("identity_changed");
      }
    },
    beginInstallation(session: Session) {
      assertUnchanged();
      installingSession = session;
    },
    async assertInstalledOwner(session: Session) {
      const { data, error } = await client.auth.getSession();
      assertUnchanged();
      if (error || data.session?.user.id !== session.user.id || !matchesInstallation(data.session)) {
        throw new ClaimEmailOtpError("identity_changed");
      }
    },
  };
}

function pendingMatches(
  pending: Pick<PendingVerification, "caseId" | "claimId" | "email" | "expectedUserId">,
  input: VerifyClaimEmailOtpInput,
) {
  return pending.caseId === input.caseId && pending.claimId === input.claimId &&
    pending.email === input.email && pending.expectedUserId === input.expectedUserId;
}

function assertVerifiedSession(session: Session | null, email: string): asserts session is Session {
  if (!session?.access_token || !session.refresh_token ||
    session.user.is_anonymous !== false || !session.user.email_confirmed_at ||
    normalizedEmail(session.user.email) !== normalizedEmail(email)) {
    throw new ClaimEmailOtpError("claim_conflict");
  }
}

function assertCompletedClaim(
  completed: CompleteTotalLossIdentityClaimResult | void,
  input: VerifyClaimEmailOtpInput,
  session: Session,
): asserts completed is CompleteTotalLossIdentityClaimResult {
  if (!completed || completed.caseId !== input.caseId ||
    completed.ownerUserId !== session.user.id || completed.claimPurpose !== "post_continue" ||
    normalizedEmail(completed.contactEmail) !== normalizedEmail(input.email)) {
    throw new ClaimEmailOtpError("claim_conflict");
  }
}

function normalizedEmail(email: string | undefined) {
  return email?.trim().toLowerCase() ?? "";
}

function authError(error: unknown) {
  const { code, status } = errorDetails(error);
  if (status === 429 || code === "over_email_send_rate_limit" || code === "over_request_rate_limit") {
    return new ClaimEmailOtpError("rate_limited");
  }
  if (code === "otp_expired") return new ClaimEmailOtpError("expired_code");
  if (code === "validation_failed" || code === "otp_disabled" || status === 403) {
    return new ClaimEmailOtpError("invalid_code");
  }
  return new ClaimEmailOtpError("request_failed");
}

function claimError(error: unknown) {
  const { code } = errorDetails(error);
  if (error instanceof TotalLossIdentityResponseError ||
    ["42501", "22023", "23505", "P0001", "P0002"].includes(code)) {
    return new ClaimEmailOtpError("claim_conflict");
  }
  return safeError(error);
}

function errorDetails(error: unknown) {
  return {
    code: typeof error === "object" && error !== null && "code" in error ? String(error.code) : "",
    status: typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 0,
  };
}

function safeError(error: unknown) {
  return error instanceof ClaimEmailOtpError ? error : new ClaimEmailOtpError("request_failed");
}

function disposeClient(client: SupabaseClient<Database>) {
  void client.auth.dispose().catch(() => undefined);
}

export const claimEmailOtpService = environment.localPostContinueEnabled &&
  supabaseClientState.status === "available" &&
  canInstallSessionForAnonymousOwner(supabaseClientState.client)
  ? createClaimEmailOtpService({
      mainClient: supabaseClientState.client,
      createIsolatedClient: () => createIsolatedClaimEmailClient(
        environment.supabaseUrl,
        environment.supabasePublishableKey,
      ),
      origin: () => window.location.origin,
    })
  : null;
