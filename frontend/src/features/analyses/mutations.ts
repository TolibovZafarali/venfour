import { useMutation } from "@tanstack/react-query";

import {
  createAnalysis,
  type CreateAnalysisInput,
} from "@/features/analyses/api/create-analysis";

export function useCreateAnalysisMutation() {
  return useMutation({
    mutationFn: (input: CreateAnalysisInput) => createAnalysis(input),
    retry: false,
  });
}
