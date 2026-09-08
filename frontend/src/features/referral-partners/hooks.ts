import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { isPermanentAuthState, useAuth } from "@/features/auth";
import { ApiError } from "@/lib/api/client";

import { referralPartnerService, type PartnerAudience } from "./service";

export const referralQueryRoot = ["referralPartners"] as const;
export const referralDraftPrefix = "venfour.referral-draft.";

export function useReferralClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  return now;
}

export function clearReferralDrafts(keepUserId?: string | null) {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(referralDraftPrefix) && (!keepUserId || !key.startsWith(`${referralDraftPrefix}${keepUserId}.`))) sessionStorage.removeItem(key);
    }
  } catch { /* Private storage can be unavailable. */ }
}

export function useReferralIdentity() {
  const { auth } = useAuth();
  const verified = isPermanentAuthState(auth) && Boolean(auth.user.email_confirmed_at);
  return { auth, userId: verified ? auth.user.id : null, token: verified ? auth.session.access_token : "" };
}

export function useReferralAccess(audience: PartnerAudience) {
  const { userId, token } = useReferralIdentity();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: [...referralQueryRoot, userId, audience, "access"],
    queryFn: ({ signal }) => referralPartnerService.access(audience, token, signal),
    enabled: Boolean(userId), retry: false, staleTime: 0, gcTime: 0,
    refetchOnWindowFocus: true, refetchInterval: 30_000,
  });
  const allowed = !query.isError && (audience === "staff" ? query.data?.is_partner_manager === true : query.data?.is_partner === true);
  useEffect(() => {
    if (query.isPending || allowed) return;
    const predicate = (candidate: { queryKey: readonly unknown[] }) => candidate.queryKey[0] === referralQueryRoot[0] && candidate.queryKey[1] === userId && candidate.queryKey[2] === audience && candidate.queryKey[3] !== "access";
    void client.cancelQueries({ predicate });
    client.removeQueries({ predicate });
    const permissionDenied = (!query.isError && query.data?.is_partner_manager === false) || (query.error instanceof ApiError && [401, 403].includes(query.error.status));
    if (audience === "staff" && userId && permissionDenied) {
      try {
        for (let index = sessionStorage.length - 1; index >= 0; index--) {
          const key = sessionStorage.key(index);
          if (key?.startsWith(`${referralDraftPrefix}${userId}.`) && [".create", ".edit.", ".template.", ".signature.staff.", ".request.staff."].some((scope) => key.includes(scope))) sessionStorage.removeItem(key);
        }
      } catch { /* No protected draft is rendered while access is unavailable. */ }
    }
  }, [allowed, audience, client, query.data?.is_partner_manager, query.error, query.isError, query.isPending, userId]);
  return { ...query, allowed };
}

export function useReferralQuery<T>(audience: PartnerAudience, action: string, payload: Record<string, unknown>, parse: (value: unknown) => T, enabled = true) {
  const { userId, token } = useReferralIdentity();
  return useQuery({
    queryKey: [...referralQueryRoot, userId, audience, action, payload],
    queryFn: async ({ signal }) => parse(await referralPartnerService.operation(audience, token, action, payload, signal)),
    enabled: Boolean(userId && enabled), retry: false, staleTime: 0, gcTime: 0, refetchOnWindowFocus: true,
    refetchInterval: action === "partner_get" || action === "staff_get" ? 15_000 : false,
  });
}

export function useReferralMutation(audience: PartnerAudience) {
  const { userId, token } = useReferralIdentity();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const busy = useRef(false);
  const activeIdentity = useRef(userId);
  useEffect(() => { activeIdentity.current = userId; return () => { activeIdentity.current = null; }; }, [userId]);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const run = async <T = unknown>(action: string, payload: Record<string, unknown>): Promise<T | undefined> => {
    if (busy.current || !userId) return;
    const identity = userId;
    const signature = JSON.stringify([identity, action, payload]);
    const requestKey = `${referralDraftPrefix}${identity}.request.${audience}.${action}.${String(payload.agreement_id ?? payload.partner_id ?? payload.template_id ?? "new")}`;
    if (request.current?.signature !== signature) {
      let existing: { signature?: string; id?: string } | null = null;
      try { existing = JSON.parse(sessionStorage.getItem(requestKey) ?? "null") as { signature?: string; id?: string } | null; } catch { /* Request identity remains stable in the open form. */ }
      request.current = { signature, id: existing?.signature === signature && typeof existing.id === "string" ? existing.id : crypto.randomUUID() };
      try { sessionStorage.setItem(requestKey, JSON.stringify(request.current)); } catch { /* Retry the same in-memory request if browser storage is unavailable. */ }
    }
    busy.current = true; setPending(true); setError(null);
    try {
      const result = await referralPartnerService.operation<T>(audience, token, action, { ...payload, request_id: request.current.id });
      if (activeIdentity.current !== identity) return;
      request.current = null;
      try { sessionStorage.removeItem(requestKey); } catch { /* Successful server state remains authoritative. */ }
      await queryClient.invalidateQueries({ queryKey: [...referralQueryRoot, identity, audience] });
      return result;
    } catch (failure) {
      if (activeIdentity.current !== identity) return;
      if (failure instanceof ApiError && [401, 403].includes(failure.status)) {
        void queryClient.cancelQueries({ queryKey: [...referralQueryRoot, identity, audience] });
        queryClient.removeQueries({ queryKey: [...referralQueryRoot, identity, audience] });
      }
      setError(failure); return undefined;
    } finally { busy.current = false; if (activeIdentity.current === identity) setPending(false); }
  };
  return { run, pending, error };
}

export function useReferralDraft<T extends object>(scope: string, initial: T) {
  const { userId } = useReferralIdentity();
  const key = `${referralDraftPrefix}${userId}.${scope}`;
  const [draft, setDraft] = useState<T>(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(key) ?? "null") as { version?: number; value?: T } | null;
      if (stored?.version === 1 && stored.value && typeof stored.value === "object") return { ...initial, ...stored.value };
    } catch { /* Continue with the current record when no readable draft exists. */ }
    return initial;
  });
  const update = useCallback((next: T) => {
    setDraft(next);
    try { sessionStorage.setItem(key, JSON.stringify({ version: 1, value: next })); } catch { /* The open form still retains authored values. */ }
  }, [key]);
  const clear = useCallback((saved?: T) => { if (saved) setDraft(saved); try { sessionStorage.removeItem(key); } catch { /* Storage is optional. */ } }, [key]);
  return { draft, update, clear };
}
