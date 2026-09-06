import { FreeValuationProcessing } from "@/features/analyses/components/free-valuation-processing";

export function LocalValuationProcessingPage() {
  return (
    <FreeValuationProcessing
      reviewKey="development-preview"
      phase="reviewing"
      vehicle="2021 Toyota Camry SE · 42,800 miles"
      development
    />
  );
}
