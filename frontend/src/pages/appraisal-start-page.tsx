import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { diminishedValueIntakeAvailable } from "@/config/product-availability";
import {
  DiminishedValuePausedState,
  DiminishedValueStartFlow,
} from "@/features/diminished-value";
import {
  AppraisalStartLayout,
  type AppraisalServiceSlug,
} from "@/features/intake";
import { NEW_TOTAL_LOSS_CASE_QUERY_PARAMETER } from "@/features/total-loss/new-appraisal";
import {
  readTotalLossIntakeCorrectionIntent,
  TOTAL_LOSS_INTAKE_CORRECTION_INTENT,
} from "@/features/total-loss/intake-correction";
import { TotalLossIntakeFlow } from "@/pages/total-loss-start-page";

const DEFAULT_SERVICE: AppraisalServiceSlug = "total-loss";
type MobileStartView = "overview" | "intake";

function serviceFromSearch(search: string): AppraisalServiceSlug {
  const service = new URLSearchParams(search).get("service");
  return service === "diminished-value" ? service : DEFAULT_SERVICE;
}

function mobileViewFromSearch(search: string): MobileStartView {
  const view = new URLSearchParams(search).get("view");
  if (view === "intake") return "intake";
  if (view !== "overview" && readTotalLossIntakeCorrectionIntent(search)) {
    return "intake";
  }
  return "overview";
}

export function AppraisalStartPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const service = serviceFromSearch(location.search);
  const mobileView = mobileViewFromSearch(location.search);
  const correctingTotalLossIntake =
    service === "total-loss" &&
    Boolean(readTotalLossIntakeCorrectionIntent(location.search));
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
    params.delete(NEW_TOTAL_LOSS_CASE_QUERY_PARAMETER);
    if (params.get("intent") === TOTAL_LOSS_INTAKE_CORRECTION_INTENT) {
      params.delete("intent");
      params.delete("focus");
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
    if (correctingTotalLossIntake) {
      params.set("view", "overview");
    } else {
      params.delete("view");
    }

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
      mobileContinueLabel={
        !totalLossSelected && !diminishedValueIntakeAvailable
          ? "View service update"
          : "Continue"
      }
      serviceSwitchDisabled={
        (totalLossSelected && totalLossBusy) ||
        (!totalLossSelected && diminishedValueBusy)
      }
      eyebrow={
        totalLossSelected
          ? correctingTotalLossIntake ? "Total Loss · Intake correction" : "Total Loss valuation"
          : diminishedValueIntakeAvailable
            ? "Manual diminished-value review"
            : "Diminished Value · Intake paused"
      }
      title={
        totalLossSelected
          ? correctingTotalLossIntake ? "Review your saved Total Loss intake" : "Start your Total Loss review"
          : diminishedValueIntakeAvailable
            ? "Submit a diminished-value review request"
            : "Diminished Value intake is currently paused"
      }
      description={
        totalLossSelected
          ? correctingTotalLossIntake
            ? "Review and correct the saved information for this same case, then resubmit when you’re ready."
            : "Upload your insurer’s valuation report from any provider, or continue without one. Venfour will gather the facts needed for independent market research and a truthful evidence review."
          : diminishedValueIntakeAvailable
            ? "We’ll securely gather accident, repair, vehicle, and contact details for a future manual review. Submission does not create an automated appraisal or schedule an appointment."
            : "Diminished Value remains part of Venfour, but customer intake is not open. Venfour is completing the Total Loss experience first."
      }
    >
      {totalLossSelected ? (
        <TotalLossIntakeFlow onBusyChange={setTotalLossBusy} />
      ) : diminishedValueIntakeAvailable ? (
        <DiminishedValueStartFlow onBusyChange={setDiminishedValueBusy} />
      ) : (
        <DiminishedValuePausedState />
      )}
    </AppraisalStartLayout>
  );
}
