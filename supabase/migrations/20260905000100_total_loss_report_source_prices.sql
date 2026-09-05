-- Preserve explicit source-price semantics in customer report projections.
-- Existing reports omit the optional field and retain their prior projection.

create or replace function public.total_loss_customer_report_projection_internal(
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
  ) || case when comparable ? 'sourcePrice' then
    jsonb_build_object('sourcePrice', comparable -> 'sourcePrice')
  else '{}'::jsonb end
  order by coalesce((comparable ->> 'comparableNumber')::integer, 2147483647)), '[]'::jsonb)
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
