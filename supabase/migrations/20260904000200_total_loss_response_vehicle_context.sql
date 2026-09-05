-- Response analysis uses the same frozen subject vehicle as the paid report.
create function public.total_loss_frozen_response_vehicle(
  requested_report_version_id uuid,
  requested_case_id uuid,
  requested_preliminary_snapshot_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  source_row public.total_loss_source_snapshots%rowtype;
  assessment_payload jsonb;
  assessment_digest text;
  source_payload jsonb;
  presentation_vehicle jsonb;
  confirmed_facts jsonb;
  expected_vehicle jsonb;
  subject_vehicle jsonb;
  extracted_vehicle jsonb;
  resolved_vin jsonb;
  field_name text;
  expected_value jsonb;
  candidate_value jsonb;
begin
  select source.* into source_row
  from public.total_loss_report_versions as report
  join public.total_loss_final_assessments as assessment
    on assessment.id = report.final_assessment_id
    and assessment.case_id = report.case_id
    and assessment.package_job_id = report.package_job_id
    and assessment.preliminary_snapshot_id = report.preliminary_snapshot_id
    and assessment.assessment_digest = report.assessment_digest
  join public.total_loss_source_snapshots as source
    on source.id = report.source_snapshot_id
    and source.id = assessment.source_snapshot_id
    and source.case_id = report.case_id
    and source.package_job_id = report.package_job_id
    and source.preliminary_snapshot_id = report.preliminary_snapshot_id
    and source.snapshot_digest = report.source_snapshot_digest
  join public.total_loss_preliminary_snapshots as preliminary
    on preliminary.id = source.preliminary_snapshot_id
    and preliminary.case_id = source.case_id
    and preliminary.analysis_job_id = source.analysis_job_id
    and preliminary.analysis_run_id = source.analysis_run_id
    and preliminary.source_intake_mode = source.source_intake_mode
    and preliminary.source_report_upload_id is not distinct from source.source_report_upload_id
    and preliminary.source_analysis_input_id is not distinct from source.source_analysis_input_id
    and preliminary.source_analysis_input_revision = source.source_analysis_input_revision
    and preliminary.snapshot_digest = source.preliminary_snapshot_digest
  where report.id = requested_report_version_id
    and report.case_id = requested_case_id
    and report.preliminary_snapshot_id = requested_preliminary_snapshot_id
    and report.status = 'published';

  if not found then
    raise exception using errcode = '55000',
      message = 'Response vehicle frozen source lineage is unavailable.';
  end if;

  select assessment.assessment, assessment.assessment_digest
  into assessment_payload, assessment_digest
  from public.total_loss_report_versions as report
  join public.total_loss_final_assessments as assessment
    on assessment.id = report.final_assessment_id
  where report.id = requested_report_version_id;

  source_payload := source_row.source_snapshot;
  if (source_payload -> 'lineage' @> jsonb_build_object(
      'caseId', source_row.case_id,
      'packageJobId', source_row.package_job_id,
      'entitlementId', source_row.entitlement_id,
      'preliminarySnapshotId', source_row.preliminary_snapshot_id,
      'sourceSnapshotId', source_row.id,
      'analysisJobId', source_row.analysis_job_id,
      'analysisRunId', source_row.analysis_run_id
    )) is not true
    or source_payload #>> '{input,intakeMode}' is distinct from upper(source_row.source_intake_mode::text)
    or source_payload #>> '{input,analysisInputId}' is distinct from source_row.source_analysis_input_id::text
    or source_payload #>> '{input,analysisInputRevision}' is distinct from source_row.source_analysis_input_revision::text
    or source_payload #>> '{input,reportUploadId}' is distinct from source_row.source_report_upload_id::text
    or source_payload ->> 'snapshotDigest' is distinct from source_row.snapshot_digest
    or public.total_loss_canonical_jsonb_digest(source_payload - 'snapshotDigest') is distinct from source_row.snapshot_digest
    or source_payload #>> '{analysis,artifactDigest}' is distinct from source_row.analysis_artifact_digest
    or public.total_loss_canonical_jsonb_digest(source_payload #> '{analysis,artifact}') is distinct from source_row.analysis_artifact_digest
    or source_payload #>> '{preliminary,snapshotDigest}' is distinct from source_row.preliminary_snapshot_digest
    or assessment_payload -> 'lineage' is distinct from jsonb_build_object(
      'caseId', source_row.case_id,
      'packageJobId', source_row.package_job_id,
      'entitlementId', source_row.entitlement_id,
      'preliminarySnapshotId', source_row.preliminary_snapshot_id,
      'sourceSnapshotId', source_row.id,
      'analysisRunId', source_row.analysis_run_id
    )
    or assessment_payload ->> 'sourceSnapshotDigest' is distinct from source_row.snapshot_digest
    or assessment_payload ->> 'analysisArtifactDigest' is distinct from source_row.analysis_artifact_digest
    or assessment_payload ->> 'assessmentDigest' is distinct from assessment_digest
    or public.total_loss_canonical_jsonb_digest(assessment_payload - 'assessmentDigest') is distinct from assessment_digest
  then
    raise exception using errcode = '55000',
      message = 'Response vehicle frozen source identity or digest conflicts.';
  end if;

  presentation_vehicle := source_payload #> '{preliminary,presentation,vehicle}';
  confirmed_facts := source_payload #> '{input,confirmedFacts}';
  subject_vehicle := assessment_payload -> 'subjectVehicle';
  if jsonb_typeof(subject_vehicle) is distinct from 'object' then
    raise exception using errcode = '55000',
      message = 'Response vehicle required frozen facts are invalid.';
  end if;
  -- Match the existing final-assessment projection, without rebuilding valuation.
  expected_vehicle := jsonb_build_object(
    'year', presentation_vehicle -> 'year',
    'make', presentation_vehicle -> 'make',
    'model', presentation_vehicle -> 'model',
    'trim', presentation_vehicle -> 'trim',
    'mileage', presentation_vehicle -> 'mileage',
    'postalCode', presentation_vehicle -> 'postalCode',
    'lossDate', presentation_vehicle -> 'lossDate',
    'vin', confirmed_facts -> 'vin',
    'vehicleConfiguration', confirmed_facts -> 'vehicleConfiguration'
  );
  if jsonb_typeof(presentation_vehicle) is distinct from 'object'
    or jsonb_typeof(confirmed_facts) is distinct from 'object'
    or subject_vehicle - 'evidenceIds' is distinct from expected_vehicle
  then
    raise exception using errcode = '55000',
      message = 'Response vehicle assessment conflicts with its frozen source.';
  end if;

  foreach field_name in array array['year', 'make', 'model', 'trim', 'mileage'] loop
    expected_value := subject_vehicle -> field_name;
    if confirmed_facts -> field_name is distinct from expected_value
      or source_payload #> array['analysis', 'artifact', 'result', 'discrepancyRequest', 'lossVehicle', field_name]
        is distinct from expected_value
    then
      raise exception using errcode = '55000',
        message = 'Response vehicle facts conflict within the frozen paid evidence.',
        detail = 'Conflicting field: ' || field_name;
    end if;
  end loop;

  if jsonb_typeof(subject_vehicle -> 'year') is distinct from 'number'
    or coalesce(subject_vehicle ->> 'year', '') !~ '^[0-9]{4}$'
    or (case when subject_vehicle ->> 'year' ~ '^[0-9]{4}$'
      then (subject_vehicle ->> 'year')::numeric not between 1886 and 2200
      else true end)
    or jsonb_typeof(subject_vehicle -> 'make') is distinct from 'string'
    or char_length(btrim(subject_vehicle ->> 'make')) not between 1 and 100
    or jsonb_typeof(subject_vehicle -> 'model') is distinct from 'string'
    or char_length(btrim(subject_vehicle ->> 'model')) not between 1 and 100
    or (subject_vehicle -> 'trim' <> 'null'::jsonb and (
      jsonb_typeof(subject_vehicle -> 'trim') is distinct from 'string'
      or char_length(btrim(subject_vehicle ->> 'trim')) not between 1 and 200
    ))
    or (subject_vehicle -> 'mileage' <> 'null'::jsonb and (
      jsonb_typeof(subject_vehicle -> 'mileage') is distinct from 'number'
      or coalesce(subject_vehicle ->> 'mileage', '') !~ '^[0-9]+$'
    ))
  then
    raise exception using errcode = '55000',
      message = 'Response vehicle required frozen facts are invalid.';
  end if;

  resolved_vin := subject_vehicle -> 'vin';
  if source_row.source_intake_mode = 'report' then
    extracted_vehicle := source_payload #> '{extraction,normalizedReport,vehicle}';
    if not source_row.extraction_available
      or jsonb_typeof(extracted_vehicle) is distinct from 'object'
      or jsonb_typeof(extracted_vehicle -> 'year') is distinct from 'number'
      or jsonb_typeof(extracted_vehicle -> 'make') is distinct from 'string'
      or jsonb_typeof(extracted_vehicle -> 'model') is distinct from 'string'
      or source_payload #>> '{sourceDocument,uploadId}' is distinct from source_row.source_report_upload_id::text
      or source_payload #>> '{sourceDocument,sha256}' is distinct from source_row.source_document_sha256
      or source_payload #>> '{extraction,documentSha256}' is distinct from source_row.source_document_sha256
      or source_payload #>> '{extraction,normalizedReportDigest}' is distinct from source_row.normalized_extraction_digest
      or public.total_loss_canonical_jsonb_digest(source_payload #> '{extraction,normalizedReport}')
        is distinct from source_row.normalized_extraction_digest
    then
      raise exception using errcode = '55000',
        message = 'Response vehicle frozen report extraction is unavailable or conflicts.';
    end if;

    foreach field_name in array array['year', 'make', 'model', 'trim', 'mileage', 'vin'] loop
      candidate_value := extracted_vehicle -> field_name;
      expected_value := subject_vehicle -> field_name;
      if candidate_value is not null and candidate_value <> 'null'::jsonb
        and expected_value is not null and expected_value <> 'null'::jsonb
        and candidate_value is distinct from expected_value
        and not (
          jsonb_typeof(candidate_value) = 'string'
          and jsonb_typeof(expected_value) = 'string'
          and lower(regexp_replace(btrim(extracted_vehicle ->> field_name), '[[:space:]]+', ' ', 'g'))
            = lower(regexp_replace(btrim(subject_vehicle ->> field_name), '[[:space:]]+', ' ', 'g'))
        )
      then
        raise exception using errcode = '55000',
          message = 'Response vehicle facts conflict with the frozen report extraction.',
          detail = 'Conflicting field: ' || field_name;
      end if;
    end loop;
    -- A document VIN stays report-derived; it never changes the paid assessment.
    if extracted_vehicle -> 'vin' is not null and extracted_vehicle -> 'vin' <> 'null'::jsonb then
      resolved_vin := extracted_vehicle -> 'vin';
    end if;
  end if;

  if resolved_vin <> 'null'::jsonb and (
    jsonb_typeof(resolved_vin) is distinct from 'string'
    or char_length(btrim(resolved_vin #>> '{}')) not between 1 and 64
  ) then
    raise exception using errcode = '55000',
      message = 'Response vehicle frozen VIN is invalid.';
  end if;

  return jsonb_build_object(
    'vin', resolved_vin,
    'year', subject_vehicle -> 'year',
    'make', subject_vehicle -> 'make',
    'model', subject_vehicle -> 'model',
    'trim', subject_vehicle -> 'trim',
    'mileageAtLoss', subject_vehicle -> 'mileage'
  );
end;
$$;

revoke all on function public.total_loss_frozen_response_vehicle(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

comment on function public.total_loss_frozen_response_vehicle(uuid, uuid, uuid) is
  'Internal projection of the published report vehicle from its exact immutable paid source; conflicting provenance fails closed.';

create or replace function public.resolve_total_loss_insurer_response_analysis_context(
  requested_job_id uuid,
  requested_processing_token uuid
)
returns table (
  job_id uuid,
  run_id uuid,
  case_id uuid,
  analysis_context jsonb,
  response_document_id uuid,
  response_document_bucket text,
  response_document_object_name text,
  response_document_media_type text,
  response_document_byte_size bigint,
  response_document_content_digest text,
  existing_extraction_version text,
  existing_extraction jsonb,
  existing_extraction_digest text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    job.id,
    run.id,
    job.case_id,
    jsonb_build_object(
      'contextVersion', run.context_version,
      'vehicle', public.total_loss_frozen_response_vehicle(
        report_version.id, job.case_id, workflow.preliminary_snapshot_id
      ),
      'insurer', jsonb_build_object(
        'name', details.insurer_name,
        'originalOffer', report_version.report #> '{executiveConclusion,insurerValuation,value}'
      ),
      'venfourAssessment', jsonb_build_object(
        'conclusionCode', final_assessment.conclusion_code,
        'supportedRange', jsonb_build_object(
          'lowMinorUnits', final_assessment.supported_range_low_minor_units,
          'medianMinorUnits', final_assessment.supported_range_median_minor_units,
          'highMinorUnits', final_assessment.supported_range_high_minor_units,
          'currency', final_assessment.currency
        ),
        'findings', final_assessment.findings,
        'limitations', final_assessment.limitations,
        'reasonCodes', final_assessment.reason_codes,
        'insurerComparableReview', report_version.report -> 'insurerComparableReview',
        'independentMarketEvidence', report_version.report -> 'independentMarketEvidence'
      ),
      'customerRequest', jsonb_build_object(
        'subject', source_message.subject,
        'body', source_message.body,
        'customerReportedSentAt', source_message.sent_at
      ),
      'insurerResponse', jsonb_build_object(
        'text', response.original_content,
        'receivedAt', response.occurred_at,
        'document', case when document.id is null then null else jsonb_build_object(
          'originalFilename', document.original_filename,
          'mediaType', document.media_type,
          'byteSize', document.byte_size
        ) end,
        'customerRecordedRevisedOffer', case when offer.id is null then null else jsonb_build_object(
          'amountMinorUnits', offer.amount_minor_units,
          'currency', offer.currency
        ) end
      ),
      'journey', jsonb_build_object(
        'phase', workflow.phase::text,
        'currentTask', workflow.current_task,
        'negotiationRoundNumber', negotiation_round.round_number
      )
    ),
    document.id,
    document.storage_bucket_id,
    document.storage_object_name,
    document.media_type,
    document.byte_size,
    document.content_digest,
    extraction.extraction_version,
    extraction.extraction,
    extraction.extraction_digest
  from public.total_loss_insurer_response_analysis_jobs as job
  join public.total_loss_insurer_response_analysis_runs as run
    on run.id = job.current_run_id
    and run.job_id = job.id
    and run.case_id = job.case_id
    and run.status = 'processing'
  join public.total_loss_claim_workflows as workflow
    on workflow.case_id = job.case_id
    and workflow.current_response_analysis_job_id = job.id
  join public.total_loss_negotiation_rounds as negotiation_round
    on negotiation_round.id = job.negotiation_round_id
    and negotiation_round.case_id = job.case_id
    and negotiation_round.status = 'response_received'
  join public.total_loss_communications as response
    on response.id = job.response_communication_id
    and response.case_id = job.case_id
    and response.negotiation_round_id = job.negotiation_round_id
    and response.direction = 'inbound'
    and response.communication_type = 'insurer_response'
    and response.status = 'confirmed'
  join public.total_loss_message_versions as source_message
    on source_message.id = job.source_message_version_id
    and source_message.case_id = job.case_id
    and source_message.message_state = 'customer_reported_sent'
  join public.total_loss_report_versions as report_version
    on report_version.id = job.source_report_version_id
    and report_version.case_id = job.case_id
    and report_version.status = 'published'
  join public.total_loss_final_assessments as final_assessment
    on final_assessment.id = report_version.final_assessment_id
    and final_assessment.case_id = report_version.case_id
  join public.total_loss_case_details as details
    on details.case_id = job.case_id
  left join public.total_loss_claim_documents as document
    on document.id = job.source_document_id
    and document.case_id = job.case_id
    and document.document_kind = 'insurer_response'
    and document.status = 'ready'
  left join public.total_loss_offers as offer
    on offer.source_communication_id = response.id
    and offer.case_id = response.case_id
    and offer.status = 'recorded'
  left join lateral (
    select extraction_row.*
    from public.total_loss_insurer_response_document_extractions as extraction_row
    where extraction_row.document_id = document.id
      and extraction_row.case_id = document.case_id
    order by extraction_row.created_at desc, extraction_row.id desc
    limit 1
  ) as extraction on true
  where job.id = requested_job_id
    and job.status = 'processing'
    and job.processing_token = requested_processing_token
    and job.processing_expires_at > statement_timestamp()
    and not exists (
      select 1 from public.total_loss_communications as successor
      where successor.case_id = response.case_id
        and successor.supersedes_communication_id = response.id
        and successor.direction = 'inbound'
        and successor.communication_type = 'insurer_response'
        and successor.status = 'confirmed'
    );
$$;

comment on function public.resolve_total_loss_insurer_response_analysis_context(uuid, uuid) is
  'Service-only active-lease context assembler. Model context is explicitly allowlisted; private document locators are separate worker fields.';
