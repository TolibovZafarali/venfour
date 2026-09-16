-- Render new initial requests from the published report and saved contact facts.
-- Listing-price statistics remain evidence, never a requested vehicle value.
begin;

create function public.total_loss_email_text_internal(value text)
returns text language sql immutable set search_path = '' as $$
  select case when value is null or btrim(value) = ''
    or value ~ '[[:cntrl:]<>\[\]{}]'
    or value ~* 'venfour'
    or lower(btrim(value)) in ('null','undefined','unknown','unavailable','n/a','not available','not disclosed')
    then null else regexp_replace(btrim(value), '[[:space:]]+', ' ', 'g') end;
$$;
revoke execute on function public.total_loss_email_text_internal(text) from public,anon,authenticated,service_role;

create function public.total_loss_email_evidence_supported_internal(item jsonb, evidence_index jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare reference text;
begin
  if jsonb_typeof(item -> 'evidenceIds') is distinct from 'array'
    or jsonb_typeof(evidence_index) is distinct from 'array'
    or coalesce(item ->> 'evidenceLabel','') not in ('INSURER_EXTRACTED','CUSTOMER_SUPPLIED','DETERMINISTIC_FINDING') then
    return false;
  end if;
  if jsonb_array_length(item -> 'evidenceIds') = 0 then return false; end if;
  for reference in select jsonb_array_elements_text(item -> 'evidenceIds') loop
    if reference is null or not exists (
      select 1 from jsonb_array_elements(evidence_index) row where row ->> 'evidenceId' = reference
    ) then return false; end if;
  end loop;
  return true;
end;
$$;
revoke execute on function public.total_loss_email_evidence_supported_internal(jsonb,jsonb) from public,anon,authenticated,service_role;

create function public.build_total_loss_reconsideration_email_internal(report jsonb, details jsonb, contact jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  copy jsonb := public.total_loss_reconsideration_template_internal();
  facts jsonb := '{}'::jsonb;
  item jsonb;
  claim text := public.total_loss_email_text_internal(details ->> 'claimReference');
  adjuster text := public.total_loss_email_text_internal(details ->> 'adjusterName');
  customer text;
  phone text := public.total_loss_email_text_internal(contact ->> 'phone_number');
  vehicle_base text;
  vehicle text;
  amount text;
  greeting text;
  request text;
  reason text;
  subject text;
  body text;
  code text;
begin
  -- Never infer trim by parsing an unverified display label.
  if jsonb_typeof(report #> '{subjectVehicle,facts}') = 'array' then
    for item in select jsonb_array_elements(report #> '{subjectVehicle,facts}') loop
      if item ->> 'key' in ('year','make','model','trim')
        and public.total_loss_email_evidence_supported_internal(item, report -> 'sourceEvidenceIndex') then
        facts := facts || jsonb_build_object(item ->> 'key', public.total_loss_email_text_internal(item ->> 'value'));
      end if;
    end loop;
  end if;
  if facts ->> 'year' ~ '^[0-9]{4}$' and facts ->> 'make' is not null and facts ->> 'model' is not null then
    vehicle_base := concat_ws(' ', facts ->> 'year', facts ->> 'make', facts ->> 'model');
  end if;
  vehicle := case when vehicle_base is not null then concat_ws(' ', vehicle_base, facts ->> 'trim')
    else copy ->> 'vehicleFallback' end;
  subject := case when claim is not null then format(copy ->> 'subjectWithClaim', claim)
    when vehicle_base is not null then format(copy ->> 'subjectWithoutClaim', vehicle_base)
    else copy ->> 'subjectFallback' end;
  adjuster := split_part(adjuster, ' ', 1);
  -- Initials and honorifics do not establish an adjuster's first name.
  if adjuster !~ '^[[:alpha:]][[:alpha:]’''-]+$'
    or lower(adjuster) in ('mr','mrs','ms','dr','claims','adjuster','representative') then adjuster := null; end if;
  greeting := case when adjuster is null then copy ->> 'greetingWithoutName'
    else format(copy ->> 'greeting', adjuster) end;
  customer := coalesce(nullif(concat_ws(' ',
    public.total_loss_email_text_internal(contact ->> 'first_name'),
    public.total_loss_email_text_internal(contact ->> 'last_name')), ''),
    public.total_loss_email_text_internal(contact ->> 'full_name'));
  if phone !~ '^[+()0-9 .-]{7,50}$' then phone := null; end if;

  -- The report money contract is USD. Format stored cents, never display prose.
  if report #>> '{executiveConclusion,insurerValuation,value,currency}' = 'USD'
    and report #>> '{executiveConclusion,insurerValuation,value,minorUnits}' ~ '^[0-9]{1,12}$' then
    amount := '$' || to_char((report #>> '{executiveConclusion,insurerValuation,value,minorUnits}')::numeric / 100,
      'FM999,999,999,990.00');
  end if;
  request := case when amount is not null then format(copy ->> 'request', amount, vehicle)
    else format(copy ->> 'requestWithoutAmount', vehicle) end;

  -- Only the existing deterministic findings are supported. No free-form
  -- error allegation or independent adjustment is inferred from raw facts.
  if jsonb_typeof(report -> 'findings') = 'array' then
    foreach code in array array['CCC_BELOW_EXTERNAL_RANGE','EXTERNAL_MEDIAN_ABOVE_CCC','CCC_ADJUSTMENTS_REDUCE_COMPARABLE_VALUES'] loop
      if exists (select 1 from jsonb_array_elements(report -> 'findings') finding
        where finding ->> 'code' = code and finding ->> 'evidenceLabel' = 'DETERMINISTIC_FINDING'
          and public.total_loss_email_evidence_supported_internal(finding, report -> 'sourceEvidenceIndex')) then
        reason := copy #>> array['findings',code];
        exit;
      end if;
    end loop;
  end if;
  body := concat_ws(E'\n\n', greeting, copy ->> 'opening', request, reason,
    copy ->> 'reviewRequest', copy ->> 'thanks',
    case when customer is not null or phone is not null then concat_ws(E'\n', copy ->> 'signoff', customer, phone) end);
  return jsonb_build_object('subject',subject,'body',body,'templateVersion',copy ->> 'version');
end;
$$;
revoke execute on function public.build_total_loss_reconsideration_email_internal(jsonb,jsonb,jsonb)
  from public,anon,authenticated,service_role;

-- Retain ownership, eligibility, revision, closure and immutable-message checks.
do $migration$
declare definition text; generation_start integer; generation_end integer; previous_generation text;
begin
  definition := pg_get_functiondef('public.prepare_total_loss_customer_message(uuid,uuid,bigint)'::regprocedure);
  generation_start := strpos(definition, '  customer_name := coalesce(');
  generation_end := strpos(definition, E'\n  select * into draft_row from public.total_loss_message_drafts');
  if generation_start = 0 or generation_end <= generation_start
    or strpos(definition, '''initial-reconsideration-v2''') = 0 then
    raise exception 'The initial reconsideration generation contract changed.';
  end if;
  previous_generation := substring(definition from generation_start for generation_end - generation_start);
  definition := replace(definition, '  generated_body text;', E'  generated_body text;\n  generated_copy jsonb;');
  definition := replace(definition, previous_generation, $new$  generated_copy := public.build_total_loss_reconsideration_email_internal(
    report_row.report,
    jsonb_build_object('claimReference', sending_row.claim_reference, 'adjusterName', sending_row.adjuster_name),
    to_jsonb(contact_row)
  );
  generated_subject := generated_copy ->> 'subject';
  generated_body := generated_copy ->> 'body';
$new$);
  definition := replace(definition, '''initial-reconsideration-v2''', 'generated_copy ->> ''templateVersion''');
  if strpos(definition, E'    or sending_row.claim_reference is null\n    or sending_row.claim_reference_confirmed_at is null') = 0 then
    raise exception 'The sending-details confirmation contract changed.';
  end if;
  definition := replace(definition,
    E'    or sending_row.claim_reference is null\n    or sending_row.claim_reference_confirmed_at is null',
    E'    or (sending_row.claim_reference is not null and sending_row.claim_reference_confirmed_at is null)');
  execute definition;
end;
$migration$;
notify pgrst, 'reload schema';
commit;
