import { describe, expect, it } from "vitest";

import {
  totalLossCaseJourneyProgress,
  type TotalLossCaseJourneyStage,
} from "@/features/total-loss-claim/case-journey";

function progress(
  stage: TotalLossCaseJourneyStage,
  options: {
    readonly continuingSupported?: boolean;
    readonly hasDraft?: boolean;
    readonly intakeMode?: "manual" | "report";
  } = {},
) {
  return totalLossCaseJourneyProgress({
    continuingSupported: options.continuingSupported ?? true,
    hasDraft: options.hasDraft ?? false,
    intakeMode: options.intakeMode ?? "report",
    stage,
  });
}

describe("total-loss case journey progress", () => {
  it("has a terminal completion only after a recorded closure", () => {
    expect(progress("response_reviewed").isCaseClosed).toBe(false);
    expect(progress("resolution")).toMatchObject({ isCaseClosed: false, isCaseActive: true, current: { id: "finalize_case" } });
    const closed = totalLossCaseJourneyProgress({ continuingSupported: true, hasDraft: true, intakeMode: "report", stage: "result", isClosed: true });
    expect(closed).toMatchObject({ isCaseClosed: true, isCaseActive: false, current: { id: "case_closed" } });
    expect(closed.position).toBe(closed.total);
  });
  it.each(["manual", "report"] as const)("returns to active waiting after the sent follow-up for %s intake", (intakeMode) => {
    const result = totalLossCaseJourneyProgress({ continuingSupported: true, hasDraft: true, intakeMode, stage: "waiting", hasFollowUp: true, followUpSent: true });
    expect(result.current.id).toBe("waiting_for_follow_up_response");
    expect(result.current.label).toBe("Waiting for insurer");
    expect(result.position).toBe(result.total);
    expect(result.isCaseActive).toBe(true);
    expect(result.steps.at(-2)?.id).toBe("prepare_follow_up");
  });
  it("keeps the current report-based journey ordered through active waiting", () => {
    const waiting = progress("waiting", { hasDraft: true });

    expect(waiting.steps.map((step) => step.id)).toEqual([
      "understand_result",
      "review_insurer_report",
      "review_market_evidence",
      "understand_comparison",
      "prepare_request",
      "send_request",
      "waiting_for_insurer",
      "response_received",
      "response_reviewing",
      "response_reviewed",
    ]);
    expect(waiting.position).toBe(7);
    expect(waiting.total).toBe(10);
    expect(waiting.current.label).toBe("Waiting for insurer");
    expect(waiting.isCaseActive).toBe(true);
  });

  it("represents preparation and sending as successive steps on the same route", () => {
    expect(progress("request")).toMatchObject({
      current: { id: "prepare_request" },
      position: 5,
      total: 10,
    });
    expect(progress("request", { hasDraft: true })).toMatchObject({
      current: { id: "send_request" },
      position: 6,
      total: 10,
    });
  });

  it("omits the insurer-report step for manual intake without branching the journey model", () => {
    expect(progress("insurer", { intakeMode: "manual" })).toMatchObject({
      current: { id: "review_market_evidence" },
      position: 2,
      total: 9,
    });
    expect(progress("waiting", { intakeMode: "manual" })).toMatchObject({
      current: { id: "waiting_for_insurer" },
      position: 6,
      total: 9,
      isCaseActive: true,
    });
  });

  it.each([
    ["report", 4],
    ["manual", 3],
  ] as const)(
    "ends an unsupported %s journey at the comparison without inventing later stages",
    (intakeMode, total) => {
      const result = progress("meaning", {
        continuingSupported: false,
        intakeMode,
      });

      expect(result.position).toBe(total);
      expect(result.total).toBe(total);
      expect(result.steps.map((step) => step.id)).not.toContain(
        "waiting_for_insurer",
      );
      expect(result.isCaseActive).toBe(false);
    },
  );

  it("preserves a server-authoritative waiting step if report continuation changes", () => {
    expect(progress("waiting", { continuingSupported: false })).toMatchObject({
      current: { id: "waiting_for_insurer" },
      position: 7,
      total: 10,
      isCaseActive: true,
    });
  });

  it.each([
    ["response_reviewing", "response_reviewing", 9, true],
    ["response_reviewed", "response_reviewed", 10, false],
  ] as const)(
    "preserves the server-authoritative %s step if report continuation changes",
    (stage, id, position, isCaseActive) => {
      expect(progress(stage, { continuingSupported: false })).toMatchObject({
        current: { id },
        position,
        total: 10,
        isCaseActive,
      });
    },
  );

  it("keeps response intake at waiting until the saved response advances the case", () => {
    expect(progress("response", { hasDraft: true })).toMatchObject({
      current: { id: "waiting_for_insurer" },
      position: 7,
      total: 10,
      isCaseActive: true,
    });
    expect(progress("response_received", { hasDraft: true })).toMatchObject({
      current: { id: "response_received" },
      position: 8,
      total: 10,
      isCaseActive: false,
    });
    expect(progress("response_reviewing", { hasDraft: true })).toMatchObject({
      current: { id: "response_reviewing" },
      position: 9,
      total: 10,
      isCaseActive: true,
    });
    expect(progress("response_reviewed", { hasDraft: true })).toMatchObject({
      current: { id: "response_reviewed" },
      position: 10,
      total: 10,
      isCaseActive: false,
    });
  });
});
