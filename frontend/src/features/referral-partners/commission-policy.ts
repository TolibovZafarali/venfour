export const outcomePolicyId = "verified-outcome-tiers-v1";

export function isOutcomeCommissionPolicy(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const policy = value as Record<string, unknown>;
  return policy.id === outcomePolicyId && policy.eligible_service === "total_loss"
    && policy.threshold_exclusive_minor_units === 100000 && policy.first_tier_count === 9
    && policy.first_tier_minor_units === 5000 && policy.next_tier_minor_units === 7500
    && policy.timezone === "America/Chicago" && policy.payment_hold_days === 30 && policy.payout_day === 15;
}

