import type { AnalysisPresentation } from "@/features/analyses/analysis-presentation.generated";
import fixture from "../../../../tests/fixtures/analysis/analysis-presentation-material-undervalue.json";

export const materialUndervalueAnalysis =
  fixture as unknown as AnalysisPresentation;

export const representativeRunId = materialUndervalueAnalysis.runId;
