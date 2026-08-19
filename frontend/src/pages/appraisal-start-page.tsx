import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import {
  createEmptyDiminishedValueDraft,
  DiminishedValueIntakeFlow,
} from "@/features/diminished-value";
import {
  AppraisalStartLayout,
  type AppraisalServiceSlug,
} from "@/features/intake";
import { useTotalLossDependencies } from "@/features/total-loss/dependencies";
import { TotalLossIntakeFlow } from "@/pages/total-loss-start-page";

const DEFAULT_SERVICE: AppraisalServiceSlug = "total-loss";

function serviceFromSearch(search: string): AppraisalServiceSlug {
  const service = new URLSearchParams(search).get("service");
  return service === "diminished-value" ? service : DEFAULT_SERVICE;
}

export function AppraisalStartPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const totalLossDependencies = useTotalLossDependencies();
  const service = serviceFromSearch(location.search);
  const [diminishedValueDraft, setDiminishedValueDraft] = useState(
    createEmptyDiminishedValueDraft,
  );
  const [selectedFiles, setSelectedFiles] = useState<readonly File[]>([]);
  const [totalLossBusy, setTotalLossBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const rawService = params.get("service");
    const hasTotalLossCaseOnDiminishedValue =
      service === "diminished-value" && params.has("caseId");

    if (rawService === service && !hasTotalLossCaseOnDiminishedValue) {
      return;
    }

    params.set("service", service);
    if (service === "diminished-value") {
      params.delete("caseId");
    }

    void navigate(
      {
        pathname: location.pathname,
        search: `?${params.toString()}`,
      },
      { replace: true, preventScrollReset: true },
    );
  }, [location.pathname, location.search, navigate, service]);

  const handleServiceChange = (nextService: AppraisalServiceSlug) => {
    if (nextService === service) return;

    const params = new URLSearchParams(location.search);
    params.set("service", nextService);
    if (nextService === "diminished-value") {
      params.delete("caseId");
    }

    void navigate(
      {
        pathname: location.pathname,
        search: `?${params.toString()}`,
      },
      { preventScrollReset: true },
    );
  };

  const totalLossSelected = service === "total-loss";

  return (
    <AppraisalStartLayout
      service={service}
      onServiceChange={handleServiceChange}
      serviceSwitchDisabled={totalLossSelected && totalLossBusy}
      eyebrow={
        totalLossSelected
          ? "Total-loss appraisal"
          : "Diminished value appraisal"
      }
      title={
        totalLossSelected
          ? "Start your total-loss appraisal"
          : "Start your diminished-value appraisal"
      }
      description={
        totalLossSelected
          ? "First, we’ll gather the information needed to check whether your insurer’s vehicle valuation appears fair."
          : "We’ll gather the accident, repair, and vehicle details needed to review how the accident may have affected your vehicle’s market value."
      }
    >
      {totalLossSelected ? (
        <TotalLossIntakeFlow onBusyChange={setTotalLossBusy} />
      ) : (
        <DiminishedValueIntakeFlow
          draft={diminishedValueDraft}
          onDraftChange={setDiminishedValueDraft}
          selectedFiles={selectedFiles}
          onSelectedFilesChange={setSelectedFiles}
          vehicleLookupService={totalLossDependencies?.vehicleLookupService}
        />
      )}
    </AppraisalStartLayout>
  );
}
