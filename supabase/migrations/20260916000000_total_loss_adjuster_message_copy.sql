-- Refresh new adjuster drafts without rewriting saved drafts or sent messages.
-- Replace only the generation block to retain later ownership and closure guards.
begin;

do $migration$
declare
  definition text;
  previous_copy text := $previous$
  customer_name := coalesce(
    nullif(concat_ws(' ', contact_row.first_name, contact_row.last_name), ''),
    contact_row.full_name,
    'Vehicle owner'
  );
  greeting_name := coalesce(sending_row.adjuster_name, 'Claims Representative');
  vehicle_description := coalesce(
    report_row.report #>> '{subjectVehicle,vehicleDisplay}',
    'the subject vehicle'
  );
  insurer_value := coalesce(
    report_row.report #>> '{executiveConclusion,insurerValuation,value,display}',
    'the valuation shown in the insurer report'
  );
  range_low := report_row.report #>>
    '{executiveConclusion,supportedAdvertisedPriceRange,low,display}';
  range_high := report_row.report #>>
    '{executiveConclusion,supportedAdvertisedPriceRange,high,display}';
  suggested_filename := report_row.report #>> '{identity,suggestedFilename}';
  insurer_name := coalesce(
    nullif(report_row.report #>> '{insurerValuationReviewed,insurerName,value}', ''),
    nullif(report_row.report #>> '{insurerValuationReviewed,insurerName,displayValue}', ''),
    'the insurer'
  );

  if range_low is null or range_high is null or suggested_filename is null then
    raise exception using errcode = '55000', message = 'Published report delivery facts are incomplete.';
  end if;

  generated_subject := format(
    'Request for valuation reconsideration - Claim %s',
    sending_row.claim_reference
  );
  generated_body := format(
    'Hello %s,%s%sI am requesting that %s provide written reconsideration of the vehicle valuation for claim %s involving %s.%s%sThe insurer valuation reviewed was %s. The enclosed Venfour Total-Loss Valuation Evidence Package supports an advertised-price range of %s to %s, subject to the assumptions and limitations stated in the report.%s%sI have attached %s. Please review the evidence and reconsider the valuation in writing. If you disagree with any comparable, adjustment, or factual point, please provide a written explanation so I can understand the basis for the decision.%s%sThank you,%s%s',
    greeting_name, E'\n', E'\n', insurer_name, sending_row.claim_reference,
    vehicle_description, E'\n', E'\n', insurer_value, range_low, range_high,
    E'\n', E'\n', suggested_filename, E'\n', E'\n', E'\n', customer_name
  );
$previous$;
  updated_copy text := $updated$
  customer_name := coalesce(
    nullif(btrim(concat_ws(' ', contact_row.first_name, contact_row.last_name)), ''),
    nullif(btrim(contact_row.full_name), ''),
    'Vehicle owner'
  );
  greeting_name := case when nullif(btrim(sending_row.adjuster_name), '') is null
    then 'Hello,' else format('Hello %s,', btrim(sending_row.adjuster_name)) end;
  vehicle_description := coalesce(
    nullif(btrim(report_row.report #>> '{subjectVehicle,vehicleDisplay}'), ''),
    'vehicle'
  );
  insurer_value := report_row.report #>> '{executiveConclusion,insurerValuation,value,display}';
  range_low := report_row.report #>>
    '{executiveConclusion,supportedAdvertisedPriceRange,low,display}';
  range_high := report_row.report #>>
    '{executiveConclusion,supportedAdvertisedPriceRange,high,display}';
  suggested_filename := report_row.report #>> '{identity,suggestedFilename}';

  if range_low is null or range_high is null or suggested_filename is null then
    raise exception using errcode = '55000', message = 'Published report delivery facts are incomplete.';
  end if;

  generated_subject := format(
    'Vehicle valuation review - Claim %s', sending_row.claim_reference
  );
  generated_body := format(
    E'%s\n\nThank you for your help with claim %s for my %s. I would appreciate another review of %s.\n\n%s\n\nCould you please reconsider the valuation based on this evidence and reply with any updated valuation? If you reach a different conclusion, a brief explanation of the relevant comparables or adjustments would help me understand.\n\nThank you for your time and help,\n%s',
    greeting_name, sending_row.claim_reference, vehicle_description,
    case when nullif(btrim(insurer_value), '') is not null
      and insurer_value !~* '(unavailable|not available|not disclosed)'
      and report_row.report #>> '{executiveConclusion,insurerValuation,value,minorUnits}' ~ '^[1-9][0-9]*$'
      then format('the %s vehicle valuation', insurer_value)
      else 'the vehicle valuation' end,
    case when btrim(range_low) <> '' and btrim(range_high) <> ''
      and range_low !~* '(unavailable|not available|not disclosed)'
      and range_high !~* '(unavailable|not available|not disclosed)'
      and report_row.report #>> '{executiveConclusion,supportedAdvertisedPriceRange,low,minorUnits}' ~ '^[1-9][0-9]*$'
      and report_row.report #>> '{executiveConclusion,supportedAdvertisedPriceRange,high,minorUnits}' ~ '^[1-9][0-9]*$'
      then format(
        'I''ve attached a market evidence report with comparable listings advertised from %s to %s. These are asking prices, with vehicle differences and limitations explained in the report.',
        range_low, range_high
      )
      else 'I''ve attached a market evidence report for your review. It explains the comparison, the vehicle differences, and the limitations of the available evidence.' end,
    customer_name
  );
$updated$;
begin
  definition := pg_get_functiondef('public.prepare_total_loss_customer_message(uuid,uuid,bigint)'::regprocedure);
  -- The leading newline belongs to the dollar-quoted migration literal only.
  previous_copy := ltrim(previous_copy, E'\n');
  updated_copy := ltrim(updated_copy, E'\n');
  if position(previous_copy in definition) = 0
    or position('''initial-reconsideration-v1''' in definition) = 0 then
    raise exception 'The initial message generation contract changed.';
  end if;
  definition := replace(definition, previous_copy, updated_copy);
  definition := replace(definition,
    '''templateVersion'', ''initial-reconsideration-v1''',
    '''templateVersion'', draft_row.generation_template_version');
  definition := replace(definition, '''initial-reconsideration-v1''', '''initial-reconsideration-v2''');
  execute definition;
end;
$migration$;

-- Accept both versions during deployment; persist the actual generator version.
do $migration$
declare definition text;
begin
  definition := pg_get_functiondef('public.store_total_loss_follow_up_draft(uuid,uuid,uuid,text,jsonb)'::regprocedure);
  if position($old$requested_generation ->> 'templateVersion' is distinct from '1'$old$ in definition) = 0
    or position($old$'follow-up-v1'$old$ in definition) = 0 then
    raise exception 'The follow-up generation contract changed.';
  end if;
  definition := replace(definition,
    $old$requested_generation ->> 'templateVersion' is distinct from '1'$old$,
    $new$coalesce(requested_generation ->> 'templateVersion', '') not in ('1', '2')$new$);
  definition := replace(definition, $old$'follow-up-v1'$old$,
    $new$'follow-up-v' || (requested_generation ->> 'templateVersion')$new$);
  execute definition;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
