import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { fullReviewPriceLabel } from "@/config/review-price";
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
type StartStage = "overview" | "intake";

function serviceFromSearch(search: string): AppraisalServiceSlug {
  const service = new URLSearchParams(search).get("service");
  return service === "diminished-value" ? service : DEFAULT_SERVICE;
}

function stageFromSearch(search: string): StartStage {
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
  const stage = stageFromSearch(location.search);
  const previousStage = useRef(stage);
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
    if (previousStage.current === stage) return;
    previousStage.current = stage;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.getElementById("appraisal-intake")?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [stage]);

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

  const handleContinue = () => {
    if (stage === "intake") return;

    const params = new URLSearchParams(location.search);
    params.set("view", "intake");

    void navigate({
      pathname: location.pathname,
      search: `?${params.toString()}`,
    });
  };

  const handleBack = () => {
    if (stage === "overview") return;

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
      caseWorkspace={totalLossSelected && Boolean(new URLSearchParams(location.search).get("caseId"))}
      service={service}
      stage={stage}
      onServiceChange={handleServiceChange}
      onContinue={handleContinue}
      continueAvailable={totalLossSelected || diminishedValueIntakeAvailable}
      onBack={handleBack}
      serviceSwitchDisabled={
        (totalLossSelected && totalLossBusy) ||
        (!totalLossSelected && diminishedValueBusy)
      }
      eyebrow={
        totalLossSelected
          ? correctingTotalLossIntake ? "Total Loss · Intake correction" : "Total Loss valuation"
          : diminishedValueIntakeAvailable
            ? "Manual diminished-value review"
            : "In development"
      }
      title={
        totalLossSelected
          ? correctingTotalLossIntake ? "Review your saved Total Loss intake" : "Start with a free valuation."
          : diminishedValueIntakeAvailable
            ? "Submit a diminished-value review request"
            : "Diminished Value review"
      }
      priceNote={totalLossSelected && !correctingTotalLossIntake ? <>Free valuation · Full review and report: <strong className="font-medium text-ink">{fullReviewPriceLabel}</strong> one-time</> : undefined}
      description={
        totalLossSelected
          ? correctingTotalLossIntake
            ? "Review and correct the saved information for this same case, then resubmit when you’re ready."
            : "Compare your insurer’s valuation with market evidence. Start with a report or your vehicle details."
          : diminishedValueIntakeAvailable
            ? "We’ll securely gather accident, repair, vehicle, and contact details for a future manual review. Submission does not create an automated appraisal or schedule an appointment."
            : "We’re working on this feature. Customer intake isn’t open yet."
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
