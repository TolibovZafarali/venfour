-- Upgrade already-applied response-analysis installations with the same public
-- evidence and grounding contracts enforced by fresh schema creation.

alter function public.total_loss_response_analysis_evidence_index_is_valid(jsonb, jsonb)
  rename to total_loss_response_evidence_index_is_valid_v1_base;

revoke execute on function public.total_loss_response_evidence_index_is_valid_v1_base(jsonb, jsonb)
  from public, anon, authenticated, service_role;

create function public.total_loss_response_analysis_evidence_index_is_valid(
  requested_evidence_index jsonb,
  requested_result jsonb
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select
    public.total_loss_response_evidence_index_is_valid_v1_base($1, $2)
    and case
      when pg_catalog.jsonb_typeof($1 -> 'responseEvidence') = 'array'
        then pg_catalog.jsonb_array_length($1 -> 'responseEvidence') <= 250
      else false
    end;
$$;

comment on function public.total_loss_response_analysis_evidence_index_is_valid(jsonb, jsonb) is
  'Validates the exact server-built customer-safe evidence projection, caps response evidence at 250 items, and binds every structured-result citation to it.';

revoke execute on function public.total_loss_response_analysis_evidence_index_is_valid(jsonb, jsonb)
  from public, anon, authenticated, service_role;

alter function public.total_loss_response_analysis_result_is_valid(jsonb, text)
  rename to total_loss_response_result_is_valid_v1_base;

revoke execute on function public.total_loss_response_result_is_valid_v1_base(jsonb, text)
  from public, anon, authenticated, service_role;

create function public.total_loss_response_analysis_result_is_valid(
  requested_result jsonb,
  requested_schema_version text
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select
    public.total_loss_response_result_is_valid_v1_base($1, $2)
    and case
      when pg_catalog.jsonb_typeof($1 -> 'analysisSummary') = 'object'
        then ($1 -> 'analysisSummary') ?& array[
          'whatInsurerSaid',
          'whatThisMeans',
          'responseEvidenceRefs',
          'caseEvidenceRefs'
        ]
          and (
            select count(*) = 4
            from pg_catalog.jsonb_object_keys($1 -> 'analysisSummary')
          )
      else false
    end
    and pg_catalog.jsonb_typeof(
      $1 #> '{analysisSummary,whatInsurerSaid}'
    ) = 'string'
    and char_length(
      $1 #>> '{analysisSummary,whatInsurerSaid}'
    ) between 1 and 2000
    and pg_catalog.jsonb_typeof(
      $1 #> '{analysisSummary,whatThisMeans}'
    ) = 'string'
    and char_length(
      $1 #>> '{analysisSummary,whatThisMeans}'
    ) between 1 and 2000
    and case
      when pg_catalog.jsonb_typeof(
        $1 #> '{analysisSummary,responseEvidenceRefs}'
      ) = 'array'
        then pg_catalog.jsonb_array_length(
          $1 #> '{analysisSummary,responseEvidenceRefs}'
        ) between 1 and 100
      else false
    end
    and case
      when pg_catalog.jsonb_typeof(
        $1 #> '{analysisSummary,caseEvidenceRefs}'
      ) = 'array'
        then pg_catalog.jsonb_array_length(
          $1 #> '{analysisSummary,caseEvidenceRefs}'
        ) between 1 and 100
      else false
    end;
$$;

comment on function public.total_loss_response_analysis_result_is_valid(jsonb, text) is
  'Validates the response-analysis result and requires an exactly shaped, evidence-grounded customer summary.';

revoke execute on function public.total_loss_response_analysis_result_is_valid(jsonb, text)
  from public, anon, authenticated, service_role;
