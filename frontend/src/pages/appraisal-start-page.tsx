import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { DiminishedValueStartFlow } from "@/features/diminished-value";
import {
  AppraisalStartLayout,
  type AppraisalServiceSlug,
} from "@/features/intake";
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
  const service = serviceFromSearch(location.search);
  const mobileView = mobileViewFromSearch(location.search);
  const [totalLossBusy, setTotalLossBusy] = useState(false);
  const [diminishedValueBusy, setDiminishedValueBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const rawService = params.get("service");
    if (rawService === service) {
      return;
    }

    params.set("service", service);

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
    params.delete("caseId");

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
      serviceSwitchDisabled={
        (totalLossSelected && totalLossBusy) ||
        (!totalLossSelected && diminishedValueBusy)
      }
      eyebrow={
        totalLossSelected
          ? "CCC total-loss review"
          : "Manual diminished-value review"
      }
      title={
        totalLossSelected
          ? "Start your CCC report review"
          : "Submit a diminished-value review request"
      }
      description={
        totalLossSelected
          ? "Automated review currently requires the original CCC valuation report PDF your insurer used. No-report review is not available in this tester release."
          : "We’ll securely gather accident, repair, vehicle, and contact details for a future manual review. Submission does not create an automated appraisal or schedule an appointment."
      }
    >
      {totalLossSelected ? (
        <TotalLossIntakeFlow onBusyChange={setTotalLossBusy} />
      ) : (
        <DiminishedValueStartFlow onBusyChange={setDiminishedValueBusy} />
      )}
    </AppraisalStartLayout>
  );
}
