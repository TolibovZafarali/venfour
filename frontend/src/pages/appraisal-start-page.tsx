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
type MobileStartView = "overview" | "intake";

function serviceFromSearch(search: string): AppraisalServiceSlug {
  const service = new URLSearchParams(search).get("service");
  return service === "diminished-value" ? service : DEFAULT_SERVICE;
}

function mobileViewFromSearch(search: string): MobileStartView {
  return new URLSearchParams(search).get("view") === "intake"
    ? "intake"
    : "overview";
}

export function AppraisalStartPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const totalLossDependencies = useTotalLossDependencies();
  const service = serviceFromSearch(location.search);
  const mobileView = mobileViewFromSearch(location.search);
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

  useEffect(() => {
    if (
      typeof window.matchMedia !== "function" ||
      !window.matchMedia("(max-width: 1023px)").matches
    ) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mobileView]);

  const handleServiceChange = (nextService: AppraisalServiceSlug) => {
    if (nextService === service) return;

    const params = new URLSearchParams(location.search);
    params.set("service", nextService);
    params.delete("view");
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

  const handleMobileContinue = () => {
    if (mobileView === "intake") return;

    const params = new URLSearchParams(location.search);
    params.set("view", "intake");

    void navigate({
      pathname: location.pathname,
      search: `?${params.toString()}`,
    });
  };

  const handleMobileBack = () => {
    if (mobileView === "overview") return;

    const params = new URLSearchParams(location.search);
    params.delete("view");

    void navigate(
      {
        pathname: location.pathname,
        search: `?${params.toString()}`,
      },
      { replace: true, preventScrollReset: true },
    );
  };

  const totalLossSelected = service === "total-loss";

  return (
    <AppraisalStartLayout
      service={service}
      mobileView={mobileView}
      onServiceChange={handleServiceChange}
      onMobileContinue={handleMobileContinue}
      onMobileBack={handleMobileBack}
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
