import { FreeValuationProcessing } from "@/features/analyses/components/free-valuation-processing";

export function LocalValuationProcessingPage() {
  return (
    <FreeValuationProcessing
      reviewKey="development-preview"
      phase="reviewing"
      development
    />
  );
}
