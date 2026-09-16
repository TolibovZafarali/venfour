-- Generated from templates/total-loss-reconsideration-email.json.
-- Run scripts/generate_reconsideration_email_template.py to refresh this snapshot.
create function public.total_loss_reconsideration_template_internal()
returns jsonb language sql immutable set search_path = '' as $function$
  select $copy${
  "version": "initial-reconsideration-v3",
  "subjectWithClaim": "Vehicle valuation review — Claim %s",
  "subjectWithoutClaim": "Vehicle valuation review — %s",
  "greeting": "Hi %s,",
  "greetingWithoutName": "Hello,",
  "opening": "Thank you for your help with my claim.",
  "request": "After reviewing the %s valuation for my %s, I’m respectfully requesting that the vehicle value be reconsidered based on the attached valuation review and supporting market evidence.",
  "requestWithoutAmount": "After reviewing the valuation for my %s, I’m respectfully requesting that the vehicle value be reconsidered based on the attached valuation review and supporting market evidence.",
  "vehicleFallback": "vehicle",
  "subjectFallback": "Vehicle valuation review",
  "findings": {
    "CCC_BELOW_EXTERNAL_RANGE": "The current valuation is below the advertised prices of the comparable vehicles identified in the attached review.",
    "EXTERNAL_MEDIAN_ABOVE_CCC": "The current valuation is below the median advertised price of the comparable vehicles identified in the attached review.",
    "CCC_ADJUSTMENTS_REDUCE_COMPARABLE_VALUES": "The attached review shows that adjustments reduced the comparable vehicle values."
  },
  "reviewRequest": "Could you please take another look and let me know whether the valuation can be revised? If the valuation changes, please send me the updated valuation report. If you arrive at a different value, I’d appreciate a brief explanation of the difference.",
  "thanks": "Thank you for your time and consideration.",
  "signoff": "Best,"
}$copy$::jsonb;
$function$;
revoke execute on function public.total_loss_reconsideration_template_internal()
  from public, anon, authenticated, service_role;
