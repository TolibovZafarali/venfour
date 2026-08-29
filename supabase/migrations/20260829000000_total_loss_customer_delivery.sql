-- Milestone 6: dormant customer delivery, guided education, and the first
-- customer-reported insurer reconsideration request.

create table public.total_loss_sending_details (
  case_id uuid primary key
    references public.total_loss_claim_workflows (case_id) on delete restrict,
  claim_reference text,
  adjuster_name text,
  adjuster_email text,
  claim_reference_confirmed_at timestamptz,
  adjuster_email_confirmed_at timestamptz,
  revision bigint not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint total_loss_sending_details_claim_reference_safe check (
    claim_reference is null
    or (
      char_length(claim_reference) between 1 and 200
      and claim_reference = regexp_replace(btrim(claim_reference), '[[:space:]]+', ' ', 'g')
      and claim_reference !~ '[[:cntrl:]]'
      and claim_reference !~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
    )
  ),
  constraint total_loss_sending_details_adjuster_name_safe check (
    adjuster_name is null
    or (
      char_length(adjuster_name) between 1 and 200
      and adjuster_name = regexp_replace(btrim(adjuster_name), '[[:space:]]+', ' ', 'g')
      and adjuster_name !~ '[[:cntrl:]]'
      and adjuster_name !~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
    )
  ),
  constraint total_loss_sending_details_adjuster_email_safe check (
    adjuster_email is null
    or (
      char_length(adjuster_email) between 3 and 320
      and adjuster_email = lower(btrim(adjuster_email))
      and adjuster_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      and adjuster_email !~ '[[:cntrl:]]'
      and adjuster_email !~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
    )
  ),
  constraint total_loss_sending_details_confirmation_complete check (
    (claim_reference_confirmed_at is null or claim_reference is not null)
    and (adjuster_email_confirmed_at is null or adjuster_email is not null)
  ),
  constraint total_loss_sending_details_revision_positive check (revision >= 1)
);

comment on table public.total_loss_sending_details is
  'Narrow customer-confirmed sending facts kept separate from immutable insurer-source facts.';

create trigger total_loss_sending_details_set_updated_at
before update on public.total_loss_sending_details
for each row execute function public.set_updated_at();

create trigger total_loss_sending_details_protect_identity
before update on public.total_loss_sending_details
for each row execute function public.protect_total_loss_stable_columns(
  'case_id', 'created_at'
);

create trigger total_loss_sending_details_require_revision
before update on public.total_loss_sending_details
for each row execute function public.require_total_loss_revision_increment();

alter table public.total_loss_sending_details enable row level security;
revoke all on table public.total_loss_sending_details
  from public, anon, authenticated, service_role;
grant select on table public.total_loss_sending_details to authenticated;
grant select, insert, update on table public.total_loss_sending_details to service_role;

alter table public.total_loss_message_drafts
  add column generated_recipient text,
  add column generated_subject text,
  add column generated_body text,
  add column generation_template_version text,
  add constraint total_loss_message_drafts_generated_baseline_complete check (
    (
      generated_recipient is null
      and generated_subject is null
      and generated_body is null
      and generation_template_version is null
    )
    or (
      generated_recipient is not null
      and char_length(generated_recipient) between 3 and 320
      and generated_subject is not null
      and char_length(generated_subject) between 1 and 998
      and generated_body is not null
      and char_length(generated_body) between 1 and 50000
      and generation_template_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    )
  );

drop index public.total_loss_message_drafts_one_current_idx;
create unique index total_loss_message_drafts_one_current_idx
  on public.total_loss_message_drafts (
    case_id,
    purpose,
    coalesce(
      negotiation_round_id,
      '00000000-0000-0000-0000-000000000000'::uuid
    ),
    coalesce(
      report_version_id,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  );

create trigger total_loss_message_drafts_protect_generated_baseline
before update on public.total_loss_message_drafts
for each row execute function public.protect_total_loss_stable_columns(
  'generated_recipient', 'generated_subject', 'generated_body',
  'generation_template_version'
);

alter table public.total_loss_message_versions
  add column client_request_id uuid;

create unique index total_loss_message_versions_client_request_key
  on public.total_loss_message_versions (case_id, client_request_id)
  where client_request_id is not null;

create unique index total_loss_communications_initial_request_key
  on public.total_loss_communications (case_id)
  where direction = 'outbound'
    and channel = 'email'
    and communication_type = 'initial_reconsideration_request'
    and status = 'confirmed';

create function public.total_loss_customer_report_access_for_user_internal(
  requested_case_id uuid,
  requested_report_version_id uuid,
  requested_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.appraisal_cases as appraisal_case
    join auth.users as owner_user on owner_user.id = appraisal_case.user_id
    join public.total_loss_claim_workflows as workflow
      on workflow.case_id = appraisal_case.id
    join public.total_loss_report_versions as report_version
      on report_version.id = $2
      and report_version.case_id = appraisal_case.id
      and report_version.status = 'published'
    join public.total_loss_report_series as report_series
      on report_series.id = report_version.report_series_id
      and report_series.case_id = report_version.case_id
      and report_series.current_published_report_version_id = report_version.id
    join public.total_loss_package_jobs as package_job
      on package_job.id = report_version.package_job_id
      and package_job.case_id = report_version.case_id
    join public.case_entitlements as entitlement
      on entitlement.id = package_job.entitlement_id
      and entitlement.case_id = package_job.case_id
    join public.commerce_orders as commerce_order
      on commerce_order.id = entitlement.order_id
      and commerce_order.case_id = entitlement.case_id
    where appraisal_case.id = $1
      and appraisal_case.user_id = $3
      and appraisal_case.service_type = 'total_loss'
      and not coalesce(owner_user.is_anonymous, false)
      and owner_user.email_confirmed_at is not null
      and workflow.current_report_version_id = report_version.id
      and (
        (entitlement.status = 'active' and commerce_order.status in ('paid', 'partially_refunded'))
        or (
          entitlement.status = 'refunded_access_retained'
          and commerce_order.status = 'refunded'
        )
      )
  );
$$;

comment on function public.total_loss_customer_report_access_for_user_internal(uuid, uuid, uuid) is
  'Internal exact-current published-report authorization for one permanent owner and valid entitlement.';

revoke execute on function public.total_loss_customer_report_access_for_user_internal(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.total_loss_customer_report_access_internal(
  requested_case_id uuid,
  requested_report_version_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and public.total_loss_customer_report_access_for_user_internal(
      $1, $2, (select auth.uid())
    );
$$;

revoke execute on function public.total_loss_customer_report_access_internal(uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.total_loss_customer_money_projection_internal(value jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when $1 is null or jsonb_typeof($1) <> 'object' then null::jsonb
    else jsonb_build_object(
      'amountMinorUnits', $1 -> 'minorUnits',
      'currency', $1 -> 'currency',
      'formatted', $1 -> 'display'
    )
  end;
$$;

revoke execute on function public.total_loss_customer_money_projection_internal(jsonb)
  from public, anon, authenticated, service_role;

create function public.total_loss_customer_stat_money_projection_internal(
  value jsonb,
  fallback_currency text
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when $1 is null or jsonb_typeof($1) <> 'object' then null::jsonb
    else jsonb_build_object(
      'amountMinorUnits', $1 -> 'cents',
      'currency', $2,
      'formatted', $1 ->> 'display'
    )
  end;
$$;

revoke execute on function public.total_loss_customer_stat_money_projection_internal(jsonb, text)
  from public, anon, authenticated, service_role;

create function public.total_loss_customer_price_summary_projection_internal(
  value jsonb,
  fallback_currency text
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when $1 is null or jsonb_typeof($1) <> 'object' then null::jsonb
    else jsonb_build_object(
      'count', coalesce(($1 ->> 'count')::integer, 0),
      'low', public.total_loss_customer_stat_money_projection_internal(
        $1 -> 'minimumPrice', $2
      ),
      'median', public.total_loss_customer_stat_money_projection_internal(
        $1 -> 'medianPrice', $2
      ),
      'high', public.total_loss_customer_stat_money_projection_internal(
        $1 -> 'maximumPrice', $2
      )
    )
  end;
$$;

revoke execute on function public.total_loss_customer_price_summary_projection_internal(jsonb, text)
  from public, anon, authenticated, service_role;

create function public.total_loss_customer_report_projection_internal(
  requested_report_version_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  report_row public.total_loss_report_versions%rowtype;
  insurer_money jsonb;
  supported_range jsonb;
  difference_fact jsonb;
  limitations jsonb;
  insurer_comparables jsonb;
  selected_comparables jsonb;
  report_currency text;
begin
  select report_version.* into report_row
  from public.total_loss_report_versions as report_version
  where report_version.id = requested_report_version_id
    and report_version.status = 'published';
  if not found then return null; end if;

  insurer_money := report_row.report #> '{executiveConclusion,insurerValuation,value}';
  supported_range := report_row.report #> '{executiveConclusion,supportedAdvertisedPriceRange}';
  report_currency := coalesce(
    insurer_money ->> 'currency',
    supported_range #>> '{median,currency}'
  );

  select calculation_value.value_json into difference_fact
  from jsonb_array_elements(
    coalesce(report_row.report #> '{adjustmentsAndCalculations,calculations}', '[]'::jsonb)
  ) as calculation(calculation_json)
  cross join lateral jsonb_array_elements(
    coalesce(calculation.calculation_json -> 'values', '[]'::jsonb)
  ) as calculation_value(value_json)
  where calculation.calculation_json ->> 'code' = 'PRIMARY_EVIDENCE_COMPARISON'
    and calculation_value.value_json ->> 'key' = 'difference'
  limit 1;

  select coalesce(
    jsonb_agg(item ->> 'description' order by item ->> 'code'),
    '[]'::jsonb
  ) into limitations
  from jsonb_array_elements(
    coalesce(report_row.report #> '{assumptionsAndLimitations,limitations}', '[]'::jsonb)
  ) as item;

  select coalesce(jsonb_agg(jsonb_build_object(
    'vehicle', comparable ->> 'vehicleDisplay',
    'mileage', comparable -> 'mileage',
    'advertisedPrice', comparable ->> 'advertisedPrice',
    'adjustedValue', comparable ->> 'adjustedValue',
    'netAdjustment', comparable ->> 'netAdjustment',
    'adjustments', jsonb_build_object(
      'package', comparable #>> '{adjustments,package}',
      'options', comparable #>> '{adjustments,options}',
      'mileage', comparable #>> '{adjustments,mileage}',
      'condition', comparable #>> '{adjustments,condition}'
    ),
    'adjustmentDisclosure', comparable ->> 'adjustmentDisclosure',
    'contributionPercent', comparable -> 'contributionPercent'
  ) order by coalesce((comparable ->> 'comparableNumber')::integer, 2147483647)), '[]'::jsonb)
  into insurer_comparables
  from jsonb_array_elements(
    coalesce(report_row.report #> '{insurerComparableReview,comparables}', '[]'::jsonb)
  ) as comparable;

  select coalesce(jsonb_agg(jsonb_build_object(
    'role', comparable ->> 'role',
    'vehicle', comparable ->> 'vehicleDisplay',
    'mileage', comparable -> 'mileage',
    'advertisedPrice', comparable ->> 'advertisedPrice',
    'dealer', comparable ->> 'dealer',
    'location', comparable ->> 'location',
    'distanceMiles', comparable -> 'distanceMiles',
    'evidenceDate', comparable ->> 'evidenceDate',
    'temporalBasis', comparable ->> 'temporalBasis'
  ) order by coalesce((comparable ->> 'rank')::integer, 2147483647)), '[]'::jsonb)
  into selected_comparables
  from jsonb_array_elements(
    coalesce(report_row.report #> '{independentMarketEvidence,comparables}', '[]'::jsonb)
  ) as comparable;

  return jsonb_build_object(
    'reportId', report_row.id,
    'versionNumber', report_row.version_number,
    'versionLabel', coalesce(
      report_row.report #>> '{identity,versionLabel}',
      'v' || report_row.version_number::text
    ),
    'issueDate', report_row.report #>> '{identity,issueDate}',
    'suggestedFilename', report_row.report #>> '{identity,suggestedFilename}',
    'status', 'published',
    'title', 'Venfour Total-Loss Valuation Evidence Package',
    'conclusion', jsonb_build_object(
      'classificationLabel', report_row.report #>> '{executiveConclusion,classificationLabel}',
      'continuingSupported',
        report_row.report #>> '{executiveConclusion,continuationStatus}' = 'SUPPORTS_CONTINUATION',
      'insurerValuation', public.total_loss_customer_money_projection_internal(insurer_money),
      'supportedRange', case when supported_range is null then null else jsonb_build_object(
        'low', public.total_loss_customer_money_projection_internal(supported_range -> 'low'),
        'median', public.total_loss_customer_money_projection_internal(supported_range -> 'median'),
        'high', public.total_loss_customer_money_projection_internal(supported_range -> 'high'),
        'evidenceBasis', case supported_range ->> 'evidenceBasis'
          when 'LOSS_DATE_HISTORICAL'
            then 'Historical advertised-price evidence from around the loss date'
          when 'CURRENT_MARKET'
            then 'Current advertised-price evidence'
          else null
        end
      ) end,
      'indicatedDifference', case when difference_fact is null then null else jsonb_build_object(
        'amountMinorUnits', difference_fact -> 'value',
        'currency', coalesce(
          supported_range #>> '{median,currency}',
          insurer_money ->> 'currency'
        ),
        'formatted', difference_fact ->> 'displayValue'
      ) end,
      'summary', report_row.report #>> '{executiveConclusion,summary}',
      'limitations', limitations,
      'preliminaryComparison', jsonb_build_object(
        'status', report_row.report #>> '{preliminaryVersusFinal,status}',
        'summary', report_row.report #>> '{preliminaryVersusFinal,summary}'
      )
    ),
    'subjectVehicle', jsonb_build_object(
      'description', report_row.report #>> '{subjectVehicle,vehicleDisplay}'
    ),
    'insurerEvidence', jsonb_build_object(
      'insurerName', nullif(
        report_row.report #>> '{insurerValuationReviewed,insurerName,value}', ''
      ),
      'comparableCount', jsonb_array_length(
        coalesce(report_row.report #> '{insurerComparableReview,comparables}', '[]'::jsonb)
      ),
      'summary', jsonb_build_object(
        'totalCount', coalesce(
          (report_row.report #>> '{insurerComparableReview,summary,totalCount}')::integer,
          0
        ),
        'advertisedPriceMissingCount', coalesce(
          (report_row.report #>> '{insurerComparableReview,summary,advertisedPriceMissingCount}')::integer,
          0
        ),
        'adjustedValueMissingCount', coalesce(
          (report_row.report #>> '{insurerComparableReview,summary,adjustedValueMissingCount}')::integer,
          0
        ),
        'fullyDisclosedAdjustmentCount', coalesce(
          (report_row.report #>> '{insurerComparableReview,summary,fullyDisclosedAdjustmentCount}')::integer,
          0
        ),
        'partiallyDisclosedAdjustmentCount', coalesce(
          (report_row.report #>> '{insurerComparableReview,summary,partiallyDisclosedAdjustmentCount}')::integer,
          0
        ),
        'undisclosedAdjustmentCount', coalesce(
          (report_row.report #>> '{insurerComparableReview,summary,undisclosedAdjustmentCount}')::integer,
          0
        ),
        'unavailableAdjustmentCount', coalesce(
          (report_row.report #>> '{insurerComparableReview,summary,unavailableAdjustmentCount}')::integer,
          0
        ),
        'advertisedPrices',
          public.total_loss_customer_price_summary_projection_internal(
            report_row.report #> '{insurerComparableReview,summary,advertisedPrices}',
            report_currency
          ),
        'adjustedValues',
          public.total_loss_customer_price_summary_projection_internal(
            report_row.report #> '{insurerComparableReview,summary,adjustedValues}',
            report_currency
          )
      ),
      'comparables', insurer_comparables,
      'methodologyStatement', report_row.report #>> '{insurerComparableReview,methodologyStatement}',
      'adjustmentContext', 'Insurer adjustments are shown as disclosed in the reviewed report; Venfour does not invent missing adjustment details.'
    ),
    'marketEvidence', jsonb_build_object(
      'primary', case
        when coalesce(
          jsonb_typeof(
            report_row.report #> '{independentMarketEvidence,primary}'
          ),
          'null'
        ) <> 'object'
          then null
        else jsonb_build_object(
          'label', report_row.report #>> '{independentMarketEvidence,primary,label}',
          'description', report_row.report #>> '{independentMarketEvidence,primary,description}',
          'evidenceDate', report_row.report #>> '{independentMarketEvidence,primary,evidenceDate}',
          'selectedCount', report_row.report #> '{independentMarketEvidence,primary,selectedCount}',
          'prices', public.total_loss_customer_price_summary_projection_internal(
            report_row.report #> '{independentMarketEvidence,primary,prices}',
            report_currency
          )
        )
      end,
      'secondary', case
        when coalesce(
          jsonb_typeof(
            report_row.report #> '{independentMarketEvidence,secondary}'
          ),
          'null'
        ) <> 'object'
          then null
        else jsonb_build_object(
          'label', report_row.report #>> '{independentMarketEvidence,secondary,label}',
          'description', report_row.report #>> '{independentMarketEvidence,secondary,description}',
          'evidenceDate', report_row.report #>> '{independentMarketEvidence,secondary,evidenceDate}',
          'selectedCount', report_row.report #> '{independentMarketEvidence,secondary,selectedCount}',
          'prices', public.total_loss_customer_price_summary_projection_internal(
            report_row.report #> '{independentMarketEvidence,secondary,prices}',
            report_currency
          )
        )
      end,
      'comparables', selected_comparables,
      'methodologyStatement', report_row.report #>> '{adjustmentsAndCalculations,methodologyStatement}',
      'evidenceDateContext', jsonb_build_object(
        'lossDate', report_row.report #>> '{evidenceCutoff,lossDate}',
        'currentObservedDate', report_row.report #>> '{evidenceCutoff,currentObservedDate}',
        'historicalEvidenceDate', report_row.report #>> '{evidenceCutoff,historicalEvidenceDate}'
      )
    )
  );
end;
$$;

revoke execute on function public.total_loss_customer_report_projection_internal(uuid)
  from public, anon, authenticated, service_role;

create function public.total_loss_customer_education_projection_internal(
  requested_case_id uuid,
  requested_report_version_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'reportVersionId', $2,
    'steps', jsonb_build_object(
      'result', coalesce((select jsonb_build_object(
        'viewedAt', progress.viewed_at,
        'completedAt', progress.completed_at,
        'skippedAt', progress.skipped_at
      ) from public.total_loss_education_progress as progress
      where progress.case_id = $1 and progress.report_version_id = $2
        and progress.step_identifier = 'result'),
        '{"viewedAt":null,"completedAt":null,"skippedAt":null}'::jsonb),
      'insurer_review', coalesce((select jsonb_build_object(
        'viewedAt', progress.viewed_at,
        'completedAt', progress.completed_at,
        'skippedAt', progress.skipped_at
      ) from public.total_loss_education_progress as progress
      where progress.case_id = $1 and progress.report_version_id = $2
        and progress.step_identifier = 'insurer_review'),
        '{"viewedAt":null,"completedAt":null,"skippedAt":null}'::jsonb),
      'valuation', coalesce((select jsonb_build_object(
        'viewedAt', progress.viewed_at,
        'completedAt', progress.completed_at,
        'skippedAt', progress.skipped_at
      ) from public.total_loss_education_progress as progress
      where progress.case_id = $1 and progress.report_version_id = $2
        and progress.step_identifier = 'valuation'),
        '{"viewedAt":null,"completedAt":null,"skippedAt":null}'::jsonb),
      'report', coalesce((select jsonb_build_object(
        'viewedAt', progress.viewed_at,
        'completedAt', progress.completed_at,
        'skippedAt', progress.skipped_at
      ) from public.total_loss_education_progress as progress
      where progress.case_id = $1 and progress.report_version_id = $2
        and progress.step_identifier = 'report'),
        '{"viewedAt":null,"completedAt":null,"skippedAt":null}'::jsonb),
      'what_next', coalesce((select jsonb_build_object(
        'viewedAt', progress.viewed_at,
        'completedAt', progress.completed_at,
        'skippedAt', progress.skipped_at
      ) from public.total_loss_education_progress as progress
      where progress.case_id = $1 and progress.report_version_id = $2
        and progress.step_identifier = 'what_next'),
        '{"viewedAt":null,"completedAt":null,"skippedAt":null}'::jsonb),
      'send', coalesce((select jsonb_build_object(
        'viewedAt', progress.viewed_at,
        'completedAt', progress.completed_at,
        'skippedAt', progress.skipped_at
      ) from public.total_loss_education_progress as progress
      where progress.case_id = $1 and progress.report_version_id = $2
        and progress.step_identifier = 'send'),
        '{"viewedAt":null,"completedAt":null,"skippedAt":null}'::jsonb)
    )
  );
$$;

revoke execute on function public.total_loss_customer_education_projection_internal(uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.total_loss_customer_sending_projection_internal(
  requested_case_id uuid,
  requested_report_version_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  contact_row public.total_loss_case_contacts%rowtype;
  details_row public.total_loss_case_details%rowtype;
  sending_row public.total_loss_sending_details%rowtype;
  report_row public.total_loss_report_versions%rowtype;
begin
  select * into contact_row from public.total_loss_case_contacts where case_id = requested_case_id;
  select * into details_row from public.total_loss_case_details where case_id = requested_case_id;
  select * into sending_row from public.total_loss_sending_details where case_id = requested_case_id;
  select * into report_row from public.total_loss_report_versions
    where id = requested_report_version_id and case_id = requested_case_id;
  return jsonb_build_object(
    'customerName', coalesce(
      nullif(concat_ws(' ', contact_row.first_name, contact_row.last_name), ''),
      contact_row.full_name
    ),
    'insurerName', coalesce(
      nullif(report_row.report #>> '{insurerValuationReviewed,insurerName,value}', ''),
      details_row.insurer_name
    ),
    'claimReference', sending_row.claim_reference,
    'vehicleDescription', report_row.report #>> '{subjectVehicle,vehicleDisplay}',
    'adjusterName', sending_row.adjuster_name,
    'adjusterEmail', sending_row.adjuster_email,
    'claimReferenceConfirmed', sending_row.claim_reference_confirmed_at is not null,
    'adjusterEmailConfirmed', sending_row.adjuster_email_confirmed_at is not null,
    'revision', coalesce(sending_row.revision, 0)
  );
end;
$$;

revoke execute on function public.total_loss_customer_sending_projection_internal(uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.total_loss_customer_message_draft_projection_internal(
  requested_case_id uuid,
  requested_report_version_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'draftId', draft.id,
    'reportVersionId', draft.report_version_id,
    'purpose', draft.purpose,
    'recipient', draft.recipient,
    'subject', draft.subject,
    'body', draft.body,
    'revision', draft.revision,
    'updatedAt', draft.updated_at
  )
  from public.total_loss_message_drafts as draft
  where draft.case_id = $1
    and draft.report_version_id = $2
    and draft.purpose = 'initial_reconsideration'
    and draft.negotiation_round_id is null;
$$;

revoke execute on function public.total_loss_customer_message_draft_projection_internal(uuid, uuid)
  from public, anon, authenticated, service_role;

drop policy "Permanent owners can read their published reports"
  on public.total_loss_report_versions;
drop policy "Permanent owners can read their ready claim documents"
  on public.total_loss_claim_documents;
drop policy "Permanent owners can read their education progress"
  on public.total_loss_education_progress;
drop policy "Permanent owners can read their message drafts"
  on public.total_loss_message_drafts;
drop policy "Permanent owners can read their message versions"
  on public.total_loss_message_versions;
drop policy "Permanent owners can read their negotiation rounds"
  on public.total_loss_negotiation_rounds;
drop policy "Permanent owners can read their confirmed communications"
  on public.total_loss_communications;
drop policy "Permanent owners can read their confirmed communication documents"
  on public.total_loss_communication_documents;

-- Customer delivery is exposed only through the narrow SECURITY DEFINER RPCs
-- below.  The foundation table grants predate that projection and would let a
-- browser bypass field allowlists (including raw report JSON and object names).
drop policy "Permanent owners can read their claim workflow"
  on public.total_loss_claim_workflows;
drop policy "Permanent owners can read their case entitlements"
  on public.case_entitlements;
drop policy "Permanent owners can read their report series"
  on public.total_loss_report_series;
drop policy "Permanent owners can read their confirmed facts"
  on public.total_loss_fact_assertions;
drop policy "Permanent owners can read their recorded offers"
  on public.total_loss_offers;
drop policy "Permanent owners can read their published recommendations"
  on public.total_loss_recommendations;

revoke select on table
  public.total_loss_claim_documents,
  public.total_loss_report_versions,
  public.total_loss_sending_details
from authenticated;

create or replace function public.authorize_total_loss_deliverable_read(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.total_loss_claim_documents as document
    join public.total_loss_report_versions as report_version
      on report_version.document_id = document.id
      and report_version.case_id = document.case_id
    where document.storage_bucket_id = 'case-deliverables'
      and document.storage_object_name = $1
      and document.status = 'ready'
      and public.total_loss_customer_report_access_internal(
        report_version.case_id, report_version.id
      )
  );
$$;

revoke execute on function public.authorize_total_loss_deliverable_read(text)
  from public, anon, authenticated, service_role;

drop policy "Owners can read published total-loss deliverables"
  on storage.objects;

create function public.get_total_loss_customer_reports(
  requested_case_id uuid,
  requested_report_version_id uuid default null
)
returns table (report jsonb)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  selected_report_id uuid;
begin
  if requested_case_id is null or (select auth.uid()) is null then return; end if;

  if requested_report_version_id is null then
    select workflow.current_report_version_id into selected_report_id
    from public.total_loss_claim_workflows as workflow
    where workflow.case_id = requested_case_id;
  else
    selected_report_id := requested_report_version_id;
  end if;

  if selected_report_id is null
    or not public.total_loss_customer_report_access_internal(
      requested_case_id, selected_report_id
    )
  then return; end if;

  return query select public.total_loss_customer_report_projection_internal(
    selected_report_id
  );
end;
$$;

comment on function public.get_total_loss_customer_reports(uuid, uuid) is
  'Returns only the exact entitled current published customer-report metadata and allowlisted evidence summary.';

revoke execute on function public.get_total_loss_customer_reports(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.get_total_loss_customer_reports(uuid, uuid)
  to authenticated;

create function public.authorize_total_loss_customer_report_download(
  requested_case_id uuid,
  requested_report_version_id uuid,
  requested_user_id uuid
)
returns table (
  case_id uuid,
  report_version_id uuid,
  report_series_id uuid,
  suggested_filename text,
  storage_bucket_id text,
  storage_object_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    report_version.case_id,
    report_version.id,
    report_version.report_series_id,
    report_version.report #>> '{identity,suggestedFilename}',
    document.storage_bucket_id,
    document.storage_object_name
  from public.total_loss_report_versions as report_version
  join public.total_loss_claim_documents as document
    on document.id = report_version.document_id
    and document.case_id = report_version.case_id
    and document.status = 'ready'
  where report_version.id = $2
    and report_version.case_id = $1
    and report_version.status = 'published'
    and public.total_loss_customer_report_access_for_user_internal($1, $2, $3);
$$;

comment on function public.authorize_total_loss_customer_report_download(uuid, uuid, uuid) is
  'Service-only exact-owner, exact-current-report, entitlement-aware private download locator.';

revoke execute on function public.authorize_total_loss_customer_report_download(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.authorize_total_loss_customer_report_download(uuid, uuid, uuid)
  to service_role;

create function public.put_total_loss_education_progress(
  requested_case_id uuid,
  requested_step_identifier text,
  requested_state text,
  expected_workflow_revision bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  workflow_row public.total_loss_claim_workflows%rowtype;
  report_id uuid;
begin
  if requested_step_identifier not in (
    'result', 'insurer_review', 'valuation', 'report', 'what_next', 'send'
  ) or requested_state not in ('viewed', 'completed', 'skipped') then
    raise exception using errcode = '22023', message = 'Education progress request is invalid.';
  end if;
  if requested_state = 'skipped' and requested_step_identifier in ('result', 'send') then
    raise exception using errcode = '22023', message = 'Required education steps cannot be skipped.';
  end if;

  select workflow.* into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = requested_case_id;
  if not found
    or workflow_row.revision is distinct from expected_workflow_revision
    or not public.is_permanent_total_loss_case_owner(requested_case_id)
  then
    raise exception using errcode = '40001', message = 'Claim workflow changed before education progress was saved.';
  end if;

  report_id := workflow_row.current_report_version_id;
  if report_id is null
    or not public.total_loss_customer_report_access_internal(requested_case_id, report_id)
  then
    raise exception using errcode = '42501', message = 'Published report access is required.';
  end if;
  if requested_step_identifier in (
      'insurer_review', 'valuation', 'report', 'what_next'
    ) and not exists (
      select 1
      from public.total_loss_education_progress as result_progress
      where result_progress.case_id = requested_case_id
        and result_progress.report_version_id = report_id
        and result_progress.step_identifier = 'result'
        and result_progress.completed_at is not null
    )
  then
    raise exception using errcode = '55000', message = 'Complete the required result step first.';
  end if;

  insert into public.total_loss_education_progress (
    case_id, report_version_id, step_identifier, viewed_at, completed_at, skipped_at
  ) values (
    requested_case_id,
    report_id,
    requested_step_identifier,
    statement_timestamp(),
    case when requested_state = 'completed' then statement_timestamp() end,
    case when requested_state = 'skipped' then statement_timestamp() end
  )
  on conflict (case_id, report_version_id, step_identifier) do update
  set
    viewed_at = coalesce(total_loss_education_progress.viewed_at, statement_timestamp()),
    completed_at = case
      when requested_state = 'completed'
        and total_loss_education_progress.skipped_at is null
      then coalesce(total_loss_education_progress.completed_at, statement_timestamp())
      else total_loss_education_progress.completed_at
    end,
    skipped_at = case
      when requested_state = 'skipped'
        and total_loss_education_progress.completed_at is null
      then coalesce(total_loss_education_progress.skipped_at, statement_timestamp())
      else total_loss_education_progress.skipped_at
    end;

  return public.total_loss_customer_education_projection_internal(
    requested_case_id, report_id
  );
end;
$$;

comment on function public.put_total_loss_education_progress(uuid, text, text, bigint) is
  'Owner mutation for persistent viewed/completed/skipped progress on the exact entitled published report.';

revoke execute on function public.put_total_loss_education_progress(uuid, text, text, bigint)
  from public, anon, service_role;
grant execute on function public.put_total_loss_education_progress(uuid, text, text, bigint)
  to authenticated;

create function public.put_total_loss_sending_details(
  requested_case_id uuid,
  requested_claim_reference text,
  requested_adjuster_name text,
  requested_adjuster_email text,
  requested_claim_reference_confirmed boolean,
  requested_adjuster_email_confirmed boolean,
  expected_revision bigint,
  expected_workflow_revision bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  workflow_row public.total_loss_claim_workflows%rowtype;
  existing_row public.total_loss_sending_details%rowtype;
  report_id uuid;
  normalized_claim_reference text := nullif(
    regexp_replace(btrim(coalesce(requested_claim_reference, '')), '[[:space:]]+', ' ', 'g'), ''
  );
  normalized_adjuster_name text := nullif(
    regexp_replace(btrim(coalesce(requested_adjuster_name, '')), '[[:space:]]+', ' ', 'g'), ''
  );
  normalized_adjuster_email text := nullif(lower(btrim(coalesce(requested_adjuster_email, ''))), '');
begin
  if requested_claim_reference_confirmed is null
    or requested_adjuster_email_confirmed is null
    or expected_revision is null
    or expected_workflow_revision is null
  then
    raise exception using errcode = '22023', message = 'Sending details request is invalid.';
  end if;
  if (requested_claim_reference_confirmed and normalized_claim_reference is null)
    or (requested_adjuster_email_confirmed and normalized_adjuster_email is null)
  then
    raise exception using errcode = '22023', message = 'Confirmed sending details require a value.';
  end if;

  select workflow.* into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = requested_case_id for update;
  if not found
    or workflow_row.revision is distinct from expected_workflow_revision
    or not public.is_permanent_total_loss_case_owner(requested_case_id)
  then
    raise exception using errcode = '40001', message = 'Claim workflow changed before sending details were saved.';
  end if;
  report_id := workflow_row.current_report_version_id;
  if report_id is null
    or not public.total_loss_customer_report_access_internal(requested_case_id, report_id)
    or not exists (
      select 1 from public.total_loss_report_versions as report_version
      where report_version.id = report_id
        and report_version.report #>> '{executiveConclusion,continuationStatus}' = 'SUPPORTS_CONTINUATION'
    )
  then
    raise exception using errcode = '42501', message = 'Sending details are unavailable for this result.';
  end if;

  select * into existing_row from public.total_loss_sending_details
  where case_id = requested_case_id for update;
  if not found then
    if expected_revision <> 0 then
      raise exception using errcode = '40001', message = 'Sending details changed before this update.';
    end if;
    insert into public.total_loss_sending_details (
      case_id, claim_reference, adjuster_name, adjuster_email,
      claim_reference_confirmed_at, adjuster_email_confirmed_at
    ) values (
      requested_case_id, normalized_claim_reference, normalized_adjuster_name,
      normalized_adjuster_email,
      case when requested_claim_reference_confirmed then statement_timestamp() end,
      case when requested_adjuster_email_confirmed then statement_timestamp() end
    );
  else
    if existing_row.revision is distinct from expected_revision then
      raise exception using errcode = '40001', message = 'Sending details changed before this update.';
    end if;
    update public.total_loss_sending_details
    set
      claim_reference = normalized_claim_reference,
      adjuster_name = normalized_adjuster_name,
      adjuster_email = normalized_adjuster_email,
      claim_reference_confirmed_at = case
        when requested_claim_reference_confirmed then
          coalesce(existing_row.claim_reference_confirmed_at, statement_timestamp())
      end,
      adjuster_email_confirmed_at = case
        when requested_adjuster_email_confirmed then
          coalesce(existing_row.adjuster_email_confirmed_at, statement_timestamp())
      end,
      revision = existing_row.revision + 1
    where case_id = requested_case_id and revision = expected_revision;
  end if;

  return public.total_loss_customer_sending_projection_internal(
    requested_case_id, report_id
  );
end;
$$;

comment on function public.put_total_loss_sending_details(uuid, text, text, text, boolean, boolean, bigint, bigint) is
  'Owner-only optimistic mutation for post-payment claim reference and adjuster delivery details without rewriting insurer-source facts.';

revoke execute on function public.put_total_loss_sending_details(uuid, text, text, text, boolean, boolean, bigint, bigint)
  from public, anon, service_role;
grant execute on function public.put_total_loss_sending_details(uuid, text, text, text, boolean, boolean, bigint, bigint)
  to authenticated;

create function public.total_loss_message_digest_internal(
  requested_recipient text,
  requested_subject text,
  requested_body text
)
returns text
language sql
immutable
strict
security definer
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(jsonb_build_object(
        'recipient', $1, 'subject', $2, 'body', $3
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$$;

revoke execute on function public.total_loss_message_digest_internal(text, text, text)
  from public, anon, authenticated, service_role;

create function public.total_loss_customer_message_version_projection_internal(
  requested_message_version_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'messageVersionId', message_version.id,
    'versionNumber', message_version.version_number,
    'state', message_version.message_state,
    'reportVersionId', message_version.report_version_id,
    'recipient', message_version.recipient,
    'subject', message_version.subject,
    'body', message_version.body,
    'createdAt', message_version.created_at
  )
  from public.total_loss_message_versions as message_version
  where message_version.id = $1;
$$;

revoke execute on function public.total_loss_customer_message_version_projection_internal(uuid)
  from public, anon, authenticated, service_role;

create function public.get_total_loss_customer_message_draft(
  requested_case_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  report_id uuid;
begin
  select workflow.current_report_version_id into report_id
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = requested_case_id;
  if report_id is null
    or not public.total_loss_customer_report_access_internal(requested_case_id, report_id)
  then return null; end if;
  return public.total_loss_customer_message_draft_projection_internal(
    requested_case_id, report_id
  );
end;
$$;

revoke execute on function public.get_total_loss_customer_message_draft(uuid)
  from public, anon, service_role;
grant execute on function public.get_total_loss_customer_message_draft(uuid)
  to authenticated;

create function public.prepare_total_loss_customer_message(
  requested_case_id uuid,
  requested_client_request_id uuid,
  expected_workflow_revision bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  workflow_row public.total_loss_claim_workflows%rowtype;
  report_row public.total_loss_report_versions%rowtype;
  sending_row public.total_loss_sending_details%rowtype;
  contact_row public.total_loss_case_contacts%rowtype;
  draft_row public.total_loss_message_drafts%rowtype;
  version_row public.total_loss_message_versions%rowtype;
  prior_version_id uuid;
  next_version_number integer;
  customer_name text;
  greeting_name text;
  vehicle_description text;
  insurer_value text;
  range_low text;
  range_high text;
  insurer_name text;
  suggested_filename text;
  generated_subject text;
  generated_body text;
begin
  if requested_case_id is null or requested_client_request_id is null
    or expected_workflow_revision is null
  then
    raise exception using errcode = '22023', message = 'Message preparation request is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_customer_message'),
    pg_catalog.hashtext(requested_case_id::text)
  );

  if not public.is_permanent_total_loss_case_owner(requested_case_id) then
    raise exception using errcode = '42501', message = 'Prepared message is unavailable.';
  end if;

  select message_version.* into version_row
  from public.total_loss_message_versions as message_version
  where message_version.case_id = requested_case_id
    and message_version.client_request_id = requested_client_request_id;
  if found then
    if version_row.message_state <> 'prepared' then
      raise exception using errcode = '55000', message = 'Client request identity was already used.';
    end if;
    select * into workflow_row from public.total_loss_claim_workflows
      where case_id = requested_case_id;
    if workflow_row.current_report_version_id is distinct from version_row.report_version_id
      or not public.total_loss_customer_report_access_internal(
        requested_case_id, version_row.report_version_id
      )
    then
      raise exception using errcode = '42501', message = 'Prepared message is unavailable.';
    end if;
    return jsonb_build_object(
      'draft', public.total_loss_customer_message_draft_projection_internal(
        requested_case_id, version_row.report_version_id
      ),
      'messageVersion', public.total_loss_customer_message_version_projection_internal(version_row.id),
      'workflowRevision', workflow_row.revision
    );
  end if;

  select workflow.* into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = requested_case_id for update;
  if not found
    or workflow_row.revision is distinct from expected_workflow_revision
    or not public.is_permanent_total_loss_case_owner(requested_case_id)
  then
    raise exception using errcode = '40001', message = 'Claim workflow changed before the message was prepared.';
  end if;
  if workflow_row.current_report_version_id is null
    or not public.total_loss_customer_report_access_internal(
      requested_case_id, workflow_row.current_report_version_id
    )
  then
    raise exception using errcode = '42501', message = 'Published report access is required.';
  end if;
  if not (
    (workflow_row.phase = 'review' and workflow_row.current_task = 'report_ready')
    or (
      workflow_row.phase = 'initial_request'
      and workflow_row.current_task = 'prepare_request'
    )
  ) or exists (
    select 1
    from public.total_loss_communications as communication
    where communication.case_id = requested_case_id
      and communication.direction = 'outbound'
      and communication.channel = 'email'
      and communication.communication_type = 'initial_reconsideration_request'
      and communication.status = 'confirmed'
  ) then
    raise exception using errcode = '55000', message = 'Message preparation is unavailable in the current workflow state.';
  end if;

  select * into report_row from public.total_loss_report_versions
  where id = workflow_row.current_report_version_id
    and case_id = requested_case_id;
  if report_row.report #>> '{executiveConclusion,continuationStatus}'
      <> 'SUPPORTS_CONTINUATION'
  then
    raise exception using errcode = '55000', message = 'This result does not support a reconsideration request.';
  end if;
  if not exists (
    select 1
    from public.total_loss_education_progress as progress
    where progress.case_id = requested_case_id
      and progress.report_version_id = report_row.id
      and progress.step_identifier = 'result'
      and progress.completed_at is not null
  ) then
    raise exception using errcode = '55000', message = 'The required result step must be completed first.';
  end if;
  if not exists (
      select 1
      from public.total_loss_education_progress as progress
      where progress.case_id = requested_case_id
        and progress.report_version_id = report_row.id
        and progress.step_identifier in (
          'insurer_review', 'valuation', 'report', 'what_next'
        )
        and progress.skipped_at is not null
    ) and (
      select count(*)
      from public.total_loss_education_progress as progress
      where progress.case_id = requested_case_id
        and progress.report_version_id = report_row.id
        and progress.step_identifier in (
          'insurer_review', 'valuation', 'report', 'what_next'
        )
        and progress.completed_at is not null
    ) <> 4
  then
    raise exception using errcode = '55000', message = 'Complete the guided review or explicitly skip to request preparation.';
  end if;

  select * into sending_row from public.total_loss_sending_details
  where case_id = requested_case_id for update;
  if not found
    or sending_row.claim_reference is null
    or sending_row.claim_reference_confirmed_at is null
    or sending_row.adjuster_email is null
    or sending_row.adjuster_email_confirmed_at is null
  then
    raise exception using errcode = '55000', message = 'Confirmed sending details are required.';
  end if;

  select * into contact_row from public.total_loss_case_contacts
  where case_id = requested_case_id;
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

  select * into draft_row from public.total_loss_message_drafts
  where case_id = requested_case_id
    and purpose = 'initial_reconsideration'
    and negotiation_round_id is null
    and report_version_id = report_row.id
  for update;
  if not found then
    insert into public.total_loss_message_drafts (
      case_id, negotiation_round_id, report_version_id, purpose,
      recipient, subject, body,
      generated_recipient, generated_subject, generated_body,
      generation_template_version
    ) values (
      requested_case_id, null, report_row.id, 'initial_reconsideration',
      sending_row.adjuster_email, generated_subject, generated_body,
      sending_row.adjuster_email, generated_subject, generated_body,
      'initial-reconsideration-v1'
    ) returning * into draft_row;
  end if;

  if draft_row.recipient is null
    or char_length(btrim(draft_row.subject)) = 0
    or char_length(btrim(draft_row.body)) = 0
  then
    raise exception using errcode = '55000', message = 'Message draft is incomplete.';
  end if;

  select message_version.id, message_version.version_number
  into prior_version_id, next_version_number
  from public.total_loss_message_versions as message_version
  where message_version.message_draft_id = draft_row.id
  order by message_version.version_number desc limit 1;
  next_version_number := coalesce(next_version_number, 0) + 1;

  insert into public.total_loss_message_versions (
    case_id, message_draft_id, negotiation_round_id, report_version_id,
    version_number, message_state, purpose, recipient, subject, body,
    message_digest, supersedes_message_version_id, client_request_id
  ) values (
    requested_case_id, draft_row.id, null, report_row.id,
    next_version_number, 'prepared', draft_row.purpose,
    draft_row.recipient, draft_row.subject, draft_row.body,
    public.total_loss_message_digest_internal(
      draft_row.recipient, draft_row.subject, draft_row.body
    ),
    prior_version_id, requested_client_request_id
  ) returning * into version_row;

  insert into public.total_loss_education_progress (
    case_id, report_version_id, step_identifier, viewed_at
  ) values (
    requested_case_id, report_row.id, 'send', statement_timestamp()
  ) on conflict (case_id, report_version_id, step_identifier) do update
  set viewed_at = coalesce(
    total_loss_education_progress.viewed_at, statement_timestamp()
  );

  if workflow_row.phase <> 'initial_request'
    or workflow_row.current_task <> 'prepare_request'
  then
    update public.total_loss_claim_workflows as workflow
    set phase = 'initial_request', current_task = 'prepare_request',
        revision = workflow.revision + 1
    where workflow.case_id = requested_case_id
      and workflow.revision = expected_workflow_revision
    returning * into workflow_row;
    if not found then
      raise exception using errcode = '40001', message = 'Claim workflow changed before the message was prepared.';
    end if;
  end if;

  insert into public.total_loss_workflow_events (
    case_id, event_type, actor_type, actor_user_id,
    associated_entity_type, associated_entity_id, client_request_id, details
  ) values (
    requested_case_id, 'message.prepared', 'customer', (select auth.uid()),
    'total_loss_message_version', version_row.id, requested_client_request_id,
    jsonb_build_object('reportVersionId', report_row.id, 'templateVersion', 'initial-reconsideration-v1')
  );

  return jsonb_build_object(
    'draft', public.total_loss_customer_message_draft_projection_internal(
      requested_case_id, report_row.id
    ),
    'messageVersion', public.total_loss_customer_message_version_projection_internal(version_row.id),
    'workflowRevision', workflow_row.revision
  );
end;
$$;

comment on function public.prepare_total_loss_customer_message(uuid, uuid, bigint) is
  'Deterministically creates the editable baseline and an immutable prepared version without any model/provider call.';

revoke execute on function public.prepare_total_loss_customer_message(uuid, uuid, bigint)
  from public, anon, service_role;
grant execute on function public.prepare_total_loss_customer_message(uuid, uuid, bigint)
  to authenticated;

create function public.patch_total_loss_customer_message_draft(
  requested_case_id uuid,
  requested_recipient text,
  requested_subject text,
  requested_body text,
  expected_revision bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  workflow_row public.total_loss_claim_workflows%rowtype;
  draft_row public.total_loss_message_drafts%rowtype;
  normalized_recipient text := lower(btrim(coalesce(requested_recipient, '')));
  normalized_subject text := btrim(coalesce(requested_subject, ''));
begin
  if normalized_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or char_length(normalized_recipient) not between 3 and 320
    or char_length(normalized_subject) not between 1 and 998
    or normalized_subject ~ '[[:cntrl:]]'
    or requested_body is null
    or char_length(btrim(requested_body)) not between 1 and 50000
  then
    raise exception using errcode = '22023', message = 'Message draft content is invalid.';
  end if;

  select * into workflow_row from public.total_loss_claim_workflows
  where case_id = requested_case_id
  for update;
  if not found
    or workflow_row.current_report_version_id is null
    or not public.total_loss_customer_report_access_internal(
      requested_case_id, workflow_row.current_report_version_id
    )
    or exists (
      select 1 from public.total_loss_communications as communication
      where communication.case_id = requested_case_id
        and communication.communication_type = 'initial_reconsideration_request'
        and communication.status = 'confirmed'
    )
  then
    raise exception using errcode = '42501', message = 'Message draft is unavailable.';
  end if;

  select * into draft_row from public.total_loss_message_drafts
  where case_id = requested_case_id
    and purpose = 'initial_reconsideration'
    and negotiation_round_id is null
    and report_version_id = workflow_row.current_report_version_id
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'Prepare the message before editing it.';
  end if;
  if draft_row.revision is distinct from expected_revision then
    raise exception using errcode = '40001', message = 'Message draft changed before this edit.';
  end if;

  update public.total_loss_message_drafts
  set recipient = normalized_recipient,
      subject = normalized_subject,
      body = requested_body,
      revision = draft_row.revision + 1
  where id = draft_row.id and revision = expected_revision
  returning * into draft_row;
  if not found then
    raise exception using errcode = '40001', message = 'Message draft changed before this edit.';
  end if;
  return public.total_loss_customer_message_draft_projection_internal(
    requested_case_id, workflow_row.current_report_version_id
  );
end;
$$;

revoke execute on function public.patch_total_loss_customer_message_draft(uuid, text, text, text, bigint)
  from public, anon, service_role;
grant execute on function public.patch_total_loss_customer_message_draft(uuid, text, text, text, bigint)
  to authenticated;

create function public.record_total_loss_customer_email_opened(
  requested_case_id uuid,
  requested_message_version_id uuid,
  requested_client_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  message_row public.total_loss_message_versions%rowtype;
  event_row public.total_loss_workflow_events%rowtype;
begin
  if requested_case_id is null or requested_message_version_id is null
    or requested_client_request_id is null
  then
    raise exception using errcode = '22023', message = 'Email-open request is invalid.';
  end if;
  select * into message_row from public.total_loss_message_versions
  where id = requested_message_version_id
    and case_id = requested_case_id
    and message_state = 'prepared';
  if not found
    or message_row.report_version_id is null
    or not public.total_loss_customer_report_access_internal(
      requested_case_id, message_row.report_version_id
    )
  then
    raise exception using errcode = '42501', message = 'Prepared message is unavailable.';
  end if;

  insert into public.total_loss_workflow_events (
    case_id, event_type, actor_type, actor_user_id,
    associated_entity_type, associated_entity_id, client_request_id
  ) values (
    requested_case_id, 'message.email_app_opened', 'customer', (select auth.uid()),
    'total_loss_message_version', requested_message_version_id,
    requested_client_request_id
  ) on conflict (case_id, client_request_id)
    where client_request_id is not null
    do nothing
  returning * into event_row;

  if not found then
    select * into event_row from public.total_loss_workflow_events
    where case_id = requested_case_id
      and client_request_id = requested_client_request_id;
    if event_row.event_type <> 'message.email_app_opened'
      or event_row.associated_entity_id is distinct from requested_message_version_id
    then
      raise exception using errcode = '55000', message = 'Client request identity was already used.';
    end if;
  end if;

  return jsonb_build_object(
    'status', 'opened',
    'eventId', event_row.id,
    'messageVersionId', requested_message_version_id,
    'authoritativeSent', false
  );
end;
$$;

comment on function public.record_total_loss_customer_email_opened(uuid, uuid, uuid) is
  'Records only a non-authoritative external email-app-open event; it never asserts sent or delivered.';

revoke execute on function public.record_total_loss_customer_email_opened(uuid, uuid, uuid)
  from public, anon, service_role;
grant execute on function public.record_total_loss_customer_email_opened(uuid, uuid, uuid)
  to authenticated;

create function public.confirm_total_loss_customer_message_sent(
  requested_case_id uuid,
  requested_message_version_id uuid,
  requested_client_request_id uuid,
  expected_workflow_revision bigint,
  confirmed_report_attached boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  workflow_row public.total_loss_claim_workflows%rowtype;
  prepared_row public.total_loss_message_versions%rowtype;
  sent_row public.total_loss_message_versions%rowtype;
  draft_row public.total_loss_message_drafts%rowtype;
  report_row public.total_loss_report_versions%rowtype;
  contact_row public.total_loss_case_contacts%rowtype;
  communication_row public.total_loss_communications%rowtype;
  round_row public.total_loss_negotiation_rounds%rowtype;
  next_version_number integer;
  existing_event public.total_loss_workflow_events%rowtype;
begin
  if requested_case_id is null or requested_message_version_id is null
    or requested_client_request_id is null or expected_workflow_revision is null
    or confirmed_report_attached is distinct from true
  then
    raise exception using errcode = '22023', message = 'Sent confirmation requires the attached-report acknowledgement.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('total_loss_customer_message'),
    pg_catalog.hashtext(requested_case_id::text)
  );

  if not public.is_permanent_total_loss_case_owner(requested_case_id) then
    raise exception using errcode = '42501', message = 'Sent confirmation is unavailable.';
  end if;

  select message_version.* into sent_row
  from public.total_loss_message_versions as message_version
  where message_version.case_id = requested_case_id
    and message_version.client_request_id = requested_client_request_id;
  if found then
    if sent_row.message_state <> 'customer_reported_sent'
      or sent_row.supersedes_message_version_id is distinct from requested_message_version_id
    then
      raise exception using errcode = '55000', message = 'Client request identity was already used.';
    end if;
    select * into communication_row from public.total_loss_communications
    where case_id = requested_case_id and message_version_id = sent_row.id;
    select * into round_row from public.total_loss_negotiation_rounds
    where id = communication_row.negotiation_round_id and case_id = requested_case_id;
    select * into workflow_row from public.total_loss_claim_workflows
    where case_id = requested_case_id;
    if workflow_row.current_report_version_id is distinct from sent_row.report_version_id
      or not public.total_loss_customer_report_access_internal(
        requested_case_id, sent_row.report_version_id
      )
    then
      raise exception using errcode = '42501', message = 'Sent confirmation is unavailable.';
    end if;
    return jsonb_build_object(
      'state', 'awaiting_insurer_response',
      'messageVersionId', sent_row.id,
      'communicationId', communication_row.id,
      'negotiationRoundId', round_row.id,
      'customerReportedSentAt', sent_row.sent_at,
      'workflowRevision', workflow_row.revision
    );
  end if;

  select communication.* into communication_row
  from public.total_loss_communications as communication
  where communication.case_id = requested_case_id
    and communication.direction = 'outbound'
    and communication.channel = 'email'
    and communication.communication_type = 'initial_reconsideration_request'
    and communication.status = 'confirmed';
  if found then
    select * into sent_row from public.total_loss_message_versions
      where id = communication_row.message_version_id;
    if sent_row.supersedes_message_version_id is distinct from requested_message_version_id then
      raise exception using errcode = '55000', message = 'A different message was already recorded as sent.';
    end if;
    select * into round_row from public.total_loss_negotiation_rounds
      where id = communication_row.negotiation_round_id;
    select * into workflow_row from public.total_loss_claim_workflows
      where case_id = requested_case_id;
    if workflow_row.current_report_version_id is distinct from sent_row.report_version_id
      or not public.total_loss_customer_report_access_internal(
        requested_case_id, sent_row.report_version_id
      )
    then
      raise exception using errcode = '42501', message = 'Sent confirmation is unavailable.';
    end if;
    return jsonb_build_object(
      'state', 'awaiting_insurer_response',
      'messageVersionId', sent_row.id,
      'communicationId', communication_row.id,
      'negotiationRoundId', round_row.id,
      'customerReportedSentAt', sent_row.sent_at,
      'workflowRevision', workflow_row.revision
    );
  end if;

  select workflow.* into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = requested_case_id for update;
  if not found
    or workflow_row.revision is distinct from expected_workflow_revision
    or not public.is_permanent_total_loss_case_owner(requested_case_id)
  then
    raise exception using errcode = '40001', message = 'Claim workflow changed before sent confirmation.';
  end if;

  select * into prepared_row from public.total_loss_message_versions
  where id = requested_message_version_id
    and case_id = requested_case_id
    and message_state = 'prepared';
  if not found
    or prepared_row.report_version_id is null
    or prepared_row.negotiation_round_id is not null
    or not public.total_loss_customer_report_access_internal(
      requested_case_id, prepared_row.report_version_id
    )
  then
    raise exception using errcode = '42501', message = 'Prepared message is unavailable.';
  end if;
  if prepared_row.report_version_id is distinct from workflow_row.current_report_version_id then
    raise exception using errcode = '55000', message = 'Prepared message references a stale report.';
  end if;

  select * into report_row from public.total_loss_report_versions
  where id = prepared_row.report_version_id and case_id = requested_case_id;
  if report_row.report #>> '{executiveConclusion,continuationStatus}'
      <> 'SUPPORTS_CONTINUATION'
  then
    raise exception using errcode = '55000', message = 'This result does not support a reconsideration request.';
  end if;
  if not exists (
    select 1
    from public.total_loss_education_progress as progress
    where progress.case_id = requested_case_id
      and progress.report_version_id = report_row.id
      and progress.step_identifier = 'result'
      and progress.completed_at is not null
  ) then
    raise exception using errcode = '55000', message = 'The required result step must be completed first.';
  end if;

  select * into draft_row from public.total_loss_message_drafts
  where id = prepared_row.message_draft_id and case_id = requested_case_id
  for update;
  if not found
    or draft_row.report_version_id is distinct from prepared_row.report_version_id
    or row(draft_row.recipient, draft_row.subject, draft_row.body) is distinct from
      row(prepared_row.recipient, prepared_row.subject, prepared_row.body)
    or public.total_loss_message_digest_internal(
      draft_row.recipient, draft_row.subject, draft_row.body
    ) is distinct from prepared_row.message_digest
  then
    raise exception using errcode = '40001', message = 'Message draft changed after this version was prepared.';
  end if;

  select max(message_version.version_number) + 1 into next_version_number
  from public.total_loss_message_versions as message_version
  where message_version.message_draft_id = draft_row.id;

  insert into public.total_loss_negotiation_rounds (
    case_id, round_number, status
  ) values (
    requested_case_id, 1, 'waiting_for_insurer'
  ) returning * into round_row;

  insert into public.total_loss_message_versions (
    case_id, message_draft_id, negotiation_round_id, report_version_id,
    version_number, message_state, purpose, recipient, subject, body,
    message_digest, supersedes_message_version_id, sent_at, client_request_id
  ) values (
    requested_case_id, draft_row.id, round_row.id, prepared_row.report_version_id,
    next_version_number, 'customer_reported_sent', prepared_row.purpose,
    prepared_row.recipient, prepared_row.subject, prepared_row.body,
    prepared_row.message_digest, prepared_row.id, statement_timestamp(),
    requested_client_request_id
  ) returning * into sent_row;

  -- The immutable sent snapshot now belongs to Round 1. The message-version
  -- row itself is immutable, so preserve that relationship on the outbound
  -- communication and workflow rather than rewriting the snapshot.
  select * into contact_row from public.total_loss_case_contacts
  where case_id = requested_case_id;

  insert into public.total_loss_communications (
    case_id, negotiation_round_id, direction, channel,
    communication_type, status, sender, recipient, subject, original_content,
    occurred_at, recorded_by_user_id, message_version_id
  ) values (
    requested_case_id, round_row.id, 'outbound', 'email',
    'initial_reconsideration_request', 'draft', contact_row.email,
    sent_row.recipient, sent_row.subject, sent_row.body,
    sent_row.sent_at, (select auth.uid()), sent_row.id
  ) returning * into communication_row;

  insert into public.total_loss_communication_documents (
    case_id, communication_id, document_id, display_order
  ) values (
    requested_case_id, communication_row.id, report_row.document_id, 0
  );

  update public.total_loss_communications
  set status = 'confirmed', confirmed_at = statement_timestamp()
  where id = communication_row.id and status = 'draft'
  returning * into communication_row;
  if not found then
    raise exception using errcode = '40001', message = 'Outbound communication changed before confirmation.';
  end if;

  update public.total_loss_negotiation_rounds
  set originating_communication_id = communication_row.id,
      revision = round_row.revision + 1
  where id = round_row.id and revision = round_row.revision
  returning * into round_row;

  update public.total_loss_claim_workflows as workflow
  set phase = 'negotiation', current_task = 'awaiting_insurer_response',
      current_negotiation_round_id = round_row.id,
      revision = workflow.revision + 1
  where workflow.case_id = requested_case_id
    and workflow.revision = expected_workflow_revision
  returning * into workflow_row;
  if not found then
    raise exception using errcode = '40001', message = 'Claim workflow changed before sent confirmation.';
  end if;

  insert into public.total_loss_education_progress (
    case_id, report_version_id, step_identifier, viewed_at, completed_at
  ) values (
    requested_case_id, report_row.id, 'send', statement_timestamp(), statement_timestamp()
  ) on conflict (case_id, report_version_id, step_identifier) do update
  set
    viewed_at = coalesce(total_loss_education_progress.viewed_at, statement_timestamp()),
    completed_at = coalesce(total_loss_education_progress.completed_at, statement_timestamp());

  insert into public.total_loss_workflow_events (
    case_id, event_type, actor_type, actor_user_id,
    associated_entity_type, associated_entity_id, client_request_id, details
  ) values (
    requested_case_id, 'message.customer_reported_sent', 'customer', (select auth.uid()),
    'total_loss_communication', communication_row.id, requested_client_request_id,
    jsonb_build_object(
      'messageVersionId', sent_row.id,
      'reportVersionId', report_row.id,
      'negotiationRoundId', round_row.id,
      'reportAttachedConfirmed', true
    )
  ) returning * into existing_event;

  return jsonb_build_object(
    'state', 'awaiting_insurer_response',
    'messageVersionId', sent_row.id,
    'communicationId', communication_row.id,
    'negotiationRoundId', round_row.id,
    'customerReportedSentAt', sent_row.sent_at,
    'workflowRevision', workflow_row.revision
  );
end;
$$;

comment on function public.confirm_total_loss_customer_message_sent(uuid, uuid, uuid, bigint, boolean) is
  'Atomic idempotent customer-reported sent confirmation creating one immutable snapshot, outbound communication, attached published report, Round 1, event, and awaiting state.';

revoke execute on function public.confirm_total_loss_customer_message_sent(uuid, uuid, uuid, bigint, boolean)
  from public, anon, service_role;
grant execute on function public.confirm_total_loss_customer_message_sent(uuid, uuid, uuid, bigint, boolean)
  to authenticated;

alter type public.total_loss_case_claim_resume_result
  add attribute commerce_amount_minor_units bigint,
  add attribute commerce_currency text,
  add attribute customer_journey jsonb,
  add attribute published_report jsonb,
  add attribute education_progress jsonb,
  add attribute sending_details jsonb,
  add attribute message_draft jsonb;

create or replace function public.resolve_total_loss_case_claim(requested_case_id uuid)
returns setof public.total_loss_case_claim_resume_result
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := (select auth.uid());
  authenticated_user auth.users%rowtype;
  contact_row public.total_loss_case_contacts%rowtype;
  workflow_row public.total_loss_claim_workflows%rowtype;
  order_row public.commerce_orders%rowtype;
  attempt_row public.checkout_attempts%rowtype;
  entitlement_row public.case_entitlements%rowtype;
  package_row public.total_loss_package_jobs%rowtype;
  report_row public.total_loss_report_versions%rowtype;
  result_row public.total_loss_case_claim_resume_result;
  safe_task text;
  next_state text;
  fulfillment_state text;
  fulfillment_retryable boolean := false;
  optional_skipped boolean := false;
  result_completed boolean := false;
  insurer_review_completed boolean := false;
  valuation_completed boolean := false;
  report_completed boolean := false;
  what_next_completed boolean := false;
  entitled_report boolean := false;
begin
  if authenticated_user_id is null or requested_case_id is null then return; end if;
  select auth_user.* into authenticated_user
  from auth.users as auth_user where auth_user.id = authenticated_user_id;
  if not found then return; end if;

  select contact.* into contact_row
  from public.appraisal_cases as appraisal_case
  join public.total_loss_case_contacts as contact on contact.case_id = appraisal_case.id
  where appraisal_case.id = requested_case_id
    and appraisal_case.user_id = authenticated_user_id
    and appraisal_case.service_type = 'total_loss';
  if not found
    or not public.total_loss_post_continue_case_is_eligible_internal(requested_case_id)
  then return; end if;

  select workflow.* into workflow_row
  from public.total_loss_claim_workflows as workflow
  where workflow.case_id = requested_case_id;
  select commerce_order.* into order_row
  from public.commerce_orders as commerce_order
  where commerce_order.case_id = requested_case_id
  order by commerce_order.created_at desc, commerce_order.id desc limit 1;
  if order_row.id is not null then
    select checkout_attempt.* into attempt_row
    from public.checkout_attempts as checkout_attempt
    where checkout_attempt.order_id = order_row.id
    order by checkout_attempt.created_at desc, checkout_attempt.id desc limit 1;
    select entitlement.* into entitlement_row
    from public.case_entitlements as entitlement
    where entitlement.order_id = order_row.id;
  end if;
  if workflow_row.current_package_job_id is not null then
    select * into package_row from public.total_loss_package_jobs
    where id = workflow_row.current_package_job_id
      and case_id = requested_case_id;
  end if;
  if workflow_row.current_report_version_id is not null then
    select * into report_row from public.total_loss_report_versions
    where id = workflow_row.current_report_version_id
      and case_id = requested_case_id;
  end if;

  if coalesce(authenticated_user.is_anonymous, false) then
    if not public.total_loss_case_identity_transfer_allowed_internal(requested_case_id) then
      return;
    end if;
    result_row.state := 'secure_required';
  elsif authenticated_user.email_confirmed_at is not null
    and nullif(btrim(authenticated_user.email), '') is not null
    and lower(btrim(authenticated_user.email)) = contact_row.email then
    result_row.state := 'secured';
  else
    result_row.state := 'account_mismatch';
  end if;

  safe_task := case
    when workflow_row.current_task in (
      'report_generation_queued', 'report_generating', 'report_review_queued',
      'report_reviewing', 'refund_pending', 'report_revision_required',
      'finalizing', 'purchase_complete', 'package_queued'
    ) then 'finalizing'
    when workflow_row.current_task in ('exception_review', 'report_failed')
      then 'exception_review'
    when workflow_row.current_task in ('report_ready', 'prepare_request')
      then workflow_row.current_task
    when workflow_row.current_task = 'no_dispute_resolved' then 'no_dispute_supported'
    when workflow_row.current_task = 'awaiting_insurer_response'
      then 'awaiting_insurer_response'
    else workflow_row.current_task
  end;

  entitled_report := result_row.state = 'secured'
    and report_row.id is not null
    and public.total_loss_customer_report_access_internal(
      requested_case_id, report_row.id
    );

  if entitled_report then
    select
      bool_or(progress.skipped_at is not null)
        filter (where progress.step_identifier in ('insurer_review', 'valuation', 'report', 'what_next')),
      bool_or(progress.completed_at is not null)
        filter (where progress.step_identifier = 'result'),
      bool_or(progress.completed_at is not null)
        filter (where progress.step_identifier = 'insurer_review'),
      bool_or(progress.completed_at is not null)
        filter (where progress.step_identifier = 'valuation'),
      bool_or(progress.completed_at is not null)
        filter (where progress.step_identifier = 'report'),
      bool_or(progress.completed_at is not null)
        filter (where progress.step_identifier = 'what_next')
    into optional_skipped, result_completed, insurer_review_completed,
      valuation_completed, report_completed, what_next_completed
    from public.total_loss_education_progress as progress
    where progress.case_id = requested_case_id
      and progress.report_version_id = report_row.id;
    optional_skipped := coalesce(optional_skipped, false);
    result_completed := coalesce(result_completed, false);
    insurer_review_completed := coalesce(insurer_review_completed, false);
    valuation_completed := coalesce(valuation_completed, false);
    report_completed := coalesce(report_completed, false);
    what_next_completed := coalesce(what_next_completed, false);
  end if;

  fulfillment_state := case
    when workflow_row.case_id is null then 'not_started'
    when entitlement_row.status in ('suspended', 'revoked')
      then 'needs_attention'
    when workflow_row.current_task = 'refund_pending'
      and entitled_report
      and report_row.report #>> '{executiveConclusion,continuationStatus}'
        <> 'SUPPORTS_CONTINUATION'
      then 'refund_pending'
    when entitlement_row.id is null and order_row.status = 'void'
      then 'needs_attention'
    when entitlement_row.id is null and order_row.id is not null then 'payment_pending'
    when safe_task = 'finalizing' then 'finalizing'
    when safe_task = 'exception_review' then 'exception_review'
    when safe_task in ('report_ready', 'prepare_request') then 'report_ready'
    when safe_task = 'no_dispute_supported' then 'no_dispute'
    when safe_task = 'awaiting_insurer_response' then 'awaiting_insurer_response'
    when safe_task = 'secure_claim' then 'not_started'
    else 'needs_attention'
  end;
  fulfillment_retryable := coalesce(package_row.status = 'retryable_failed', false);

  next_state := case
    when result_row.state <> 'secured' then 'secure_claim'
    when workflow_row.case_id is null then null
    when entitlement_row.status in ('suspended', 'revoked') then 'needs_attention'
    when entitlement_row.id is null and order_row.status = 'void'
      then 'needs_attention'
    when entitlement_row.id is null and attempt_row.status = 'complete'
      then 'checkout_confirmation'
    when entitlement_row.id is null then 'checkout'
    when safe_task = 'awaiting_insurer_response' then 'awaiting_insurer_response'
    when safe_task = 'no_dispute_supported' then 'no_dispute'
    when workflow_row.current_task = 'refund_pending'
      and entitled_report
      and report_row.report #>> '{executiveConclusion,continuationStatus}'
        <> 'SUPPORTS_CONTINUATION'
      then 'no_dispute'
    when safe_task in ('finalizing', 'exception_review') then 'processing'
    when safe_task not in ('report_ready', 'prepare_request') then 'needs_attention'
    when not entitled_report then 'needs_attention'
    when report_row.report #>> '{executiveConclusion,continuationStatus}'
      <> 'SUPPORTS_CONTINUATION' then 'no_dispute'
    when not result_completed then 'guide_result'
    when safe_task = 'prepare_request' or optional_skipped then 'prepare_request'
    when not insurer_review_completed then 'guide_insurer_review'
    when not valuation_completed then 'guide_valuation'
    when not report_completed then 'guide_report'
    when not what_next_completed then 'guide_what_next'
    else 'prepare_request'
  end;

  result_row.case_id := requested_case_id;
  result_row.contact_email := contact_row.email;
  result_row.workflow_phase := workflow_row.phase::text;
  result_row.workflow_current_task := safe_task;
  result_row.workflow_revision := workflow_row.revision;
  result_row.checkout_available := coalesce((
    result_row.state = 'secured'
    and workflow_row.phase = 'review'
    and workflow_row.current_task = 'secure_claim'
    and entitlement_row.id is null
    and (
      order_row.id is null
      or (order_row.status = 'pending' and order_row.purchaser_email is not null)
    )
    and not exists (
      select 1 from public.checkout_attempts as completed_attempt
      where completed_attempt.order_id = order_row.id
        and completed_attempt.status = 'complete'
    )
  ), false);
  if result_row.state = 'secured' then
    result_row.commerce_order_status := order_row.status::text;
    result_row.payment_status := case
      when order_row.id is null then null
      when order_row.status = 'pending' then 'pending'
      when order_row.status = 'paid' then 'succeeded'
      when order_row.status in ('partially_refunded', 'refunded') then 'refunded'
      when order_row.status = 'disputed' then 'disputed'
      else null
    end;
    result_row.entitlement_status := entitlement_row.status::text;
    result_row.next_task := case
      when entitlement_row.status = 'suspended' then 'payment_review'
      when entitlement_row.status = 'revoked' then 'purchase_unavailable'
      when entitlement_row.id is not null
        and workflow_row.current_package_job_id is not null then safe_task
      when entitlement_row.id is not null then 'purchase_complete'
      when result_row.checkout_available then 'checkout'
      when order_row.status = 'void' then 'purchase_unavailable'
      else safe_task
    end;
    result_row.commerce_amount_minor_units := order_row.amount_minor_units;
    result_row.commerce_currency := order_row.currency;
    if workflow_row.case_id is null then
      result_row.checkout_available := false;
      result_row.commerce_order_status := null;
      result_row.payment_status := null;
      result_row.entitlement_status := null;
      result_row.next_task := null;
      result_row.commerce_amount_minor_units := null;
      result_row.commerce_currency := null;
      result_row.customer_journey := null;
    else
      result_row.customer_journey := jsonb_build_object(
        'nextState', next_state,
        'fulfillmentState', fulfillment_state,
        'retryable', fulfillment_retryable
      );
      if entitled_report then
        result_row.published_report :=
          public.total_loss_customer_report_projection_internal(report_row.id);
        result_row.education_progress :=
          public.total_loss_customer_education_projection_internal(
            requested_case_id, report_row.id
          );
        result_row.sending_details :=
          public.total_loss_customer_sending_projection_internal(
            requested_case_id, report_row.id
          );
        if report_row.report #>> '{executiveConclusion,continuationStatus}'
            = 'SUPPORTS_CONTINUATION'
        then
          result_row.message_draft :=
            public.total_loss_customer_message_draft_projection_internal(
              requested_case_id, report_row.id
            );
        end if;
      end if;
    end if;
  else
    result_row.commerce_order_status := null;
    result_row.payment_status := null;
    result_row.entitlement_status := null;
    result_row.next_task := null;
    result_row.commerce_amount_minor_units := null;
    result_row.commerce_currency := null;
    result_row.customer_journey := jsonb_build_object(
      'nextState', 'secure_claim',
      'fulfillmentState', 'not_started',
      'retryable', false
    );
  end if;
  return next result_row;
end;
$$;

comment on function public.resolve_total_loss_case_claim(uuid) is
  'Authoritative customer-safe resolver for identity, payment, fulfillment, guided education, report delivery, request preparation, and waiting state.';

drop function public.list_owned_case_operations();

create function public.list_owned_case_operations()
returns table (
  case_id uuid,
  owner_user_id uuid,
  service_type public.appraisal_service_type,
  case_status public.appraisal_case_status,
  case_stage public.case_operation_stage,
  needs_attention boolean,
  case_created_at timestamptz,
  case_updated_at timestamptz,
  last_activity_at timestamptz,
  report_uploaded_at timestamptz,
  analysis_status public.total_loss_analysis_status,
  analysis_attempt_count integer,
  analysis_retryable boolean,
  analysis_failure_code text,
  analysis_processing_expires_at timestamptz,
  claim_resume_task text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    operation.case_id,
    operation.owner_user_id,
    operation.service_type,
    operation.case_status,
    operation.case_stage,
    operation.case_stage in (
      'analysis_failed'::public.case_operation_stage,
      'needs_attention'::public.case_operation_stage
    ) or (
      operation.report_upload_id is not null
      and operation.report_upload_expires_at <= statement_timestamp()
    ) or (
      operation.report_last_upload_id is not null
      and operation.report_upload_id is null
      and not operation.canonical_report_available
    ) as needs_attention,
    operation.case_created_at,
    operation.case_updated_at,
    operation.last_activity_at,
    operation.report_uploaded_at,
    operation.analysis_status,
    operation.analysis_attempt_count,
    operation.analysis_retryable,
    operation.analysis_failure_code,
    operation.analysis_processing_expires_at,
    case
      when resolver.workflow_phase is null
        or resolver.workflow_current_task is null
        or resolver.workflow_revision is null
      then null
      else case resolver.customer_journey ->> 'nextState'
        when 'secure_claim' then 'secure_claim'
        when 'checkout' then 'continue_payment'
        when 'checkout_confirmation' then 'continue_payment'
        when 'processing' then 'preparing_report'
        when 'guide_result' then 'review_report'
        when 'guide_insurer_review' then 'review_report'
        when 'guide_valuation' then 'review_report'
        when 'guide_report' then 'review_report'
        when 'guide_what_next' then 'review_report'
        when 'prepare_request' then 'prepare_request'
        when 'awaiting_insurer_response' then 'waiting_for_insurer'
        when 'no_dispute' then 'review_complete'
        when 'needs_attention' then 'needs_attention'
        else null
      end
    end as claim_resume_task
  from public.total_loss_case_operations_internal as operation
  left join lateral public.resolve_total_loss_case_claim(operation.case_id)
    as resolver on true
  where operation.owner_user_id = (select auth.uid())
    and (
      operation.case_status <> 'draft'
      or not exists (
        select 1
        from public.appraisal_cases as newer_draft
        where newer_draft.user_id = operation.owner_user_id
          and newer_draft.service_type = 'total_loss'
          and newer_draft.status = 'draft'
          and row(newer_draft.last_activity_at, newer_draft.created_at, newer_draft.id)
            > row(operation.last_activity_at, operation.case_created_at, operation.case_id)
      )
    )

  union all

  select
    appraisal_case.id,
    appraisal_case.user_id,
    appraisal_case.service_type,
    appraisal_case.status,
    case appraisal_case.status
      when 'draft' then 'intake_in_progress'::public.case_operation_stage
      when 'submitted' then 'submitted'::public.case_operation_stage
      when 'closed' then 'closed'::public.case_operation_stage
      else 'needs_attention'::public.case_operation_stage
    end,
    appraisal_case.status not in ('draft', 'submitted', 'closed'),
    appraisal_case.created_at,
    appraisal_case.updated_at,
    appraisal_case.last_activity_at,
    null::timestamptz,
    null::public.total_loss_analysis_status,
    null::integer,
    null::boolean,
    null::text,
    null::timestamptz,
    null::text
  from public.appraisal_cases as appraisal_case
  where appraisal_case.user_id = (select auth.uid())
    and appraisal_case.service_type = 'diminished_value'

  order by last_activity_at desc, case_id desc;
$$;

comment on function public.list_owned_case_operations() is
  'Backward-compatible owned case list with one additive customer-safe post-Continue resume task; cases outside that workflow retain their existing stage.';

revoke execute on function public.list_owned_case_operations() from public, anon, service_role;
grant execute on function public.list_owned_case_operations() to authenticated;
