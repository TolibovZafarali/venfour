import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EmbeddedPayment } from "./embedded-payment";

const payment = vi.hoisted(() => ({
  confirm: vi.fn(),
  initialize: vi.fn(),
  loadStripe: vi.fn(async () => ({})),
  checkoutType: "success" as "loading" | "success",
}));

vi.mock("@stripe/stripe-js/pure", () => ({ loadStripe: payment.loadStripe }));
vi.mock("@stripe/react-stripe-js/checkout", async () => {
  const { useEffect } = await import("react");
  return {
    CheckoutElementsProvider: ({ children }: { children: ReactNode }) => children,
    PaymentElement: ({ onReady }: { onReady: () => void }) => {
      useEffect(() => { onReady(); }, [onReady]);
      return <div>Secure payment fields</div>;
    },
    useCheckoutElements: () => ({
      type: payment.checkoutType,
      checkout: { confirm: payment.confirm },
    }),
  };
});
vi.mock("@/features/total-loss-claim/queries", () => ({
  useTotalLossCheckoutMutation: () => ({ mutateAsync: payment.initialize }),
}));

type ConfirmationResult =
  | { type: "success" }
  | { type: "error"; error: { message: string } };

function pendingConfirmation() {
  let resolve!: (result: ConfirmationResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ConfirmationResult>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe("embedded payment confirmation", () => {
  beforeEach(() => {
    payment.checkoutType = "success";
    payment.confirm.mockReset();
    payment.initialize.mockReset();
    payment.initialize.mockResolvedValue({
      state: "checkout_ready",
      checkoutSessionId: "cs_test_duplicate_submit",
      clientSecret: "cs_test_duplicate_submit" + "_secret_local_fixture",
      publishableKey: "pk_test_" + "local_duplicate_fixture",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const loadingPayment = () => (
    <EmbeddedPayment
      accessToken="local-fixture-access"
      caseId="33333333-3333-4333-8333-333333333333"
      onConfirm={vi.fn()}
      userId="22222222-2222-4222-8222-222222222222"
    />
  );

  it("offers an explicit same-page reload after persistent loading without retrying or confirming payment", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    payment.checkoutType = "loading";
    render(loadingPayment());
    await act(async () => {});

    expect(screen.getByRole("status")).toHaveTextContent("Loading secure payment fields");
    await act(async () => { vi.advanceTimersByTime(19_999); });
    expect(screen.queryByRole("button", { name: "Reload secure payment" })).not.toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole("alert")).toHaveTextContent("No payment has been taken on this page");
    expect(screen.getByRole("button", { name: "Complete purchase" })).toBeDisabled();
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(payment.initialize).toHaveBeenCalledTimes(1);
    expect(payment.confirm).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reload secure payment" }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(payment.initialize).toHaveBeenCalledTimes(1);
    expect(payment.confirm).not.toHaveBeenCalled();
  });

  it("cancels delayed-loading recovery when payment fields become ready before the deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    payment.checkoutType = "loading";
    const view = render(loadingPayment());
    await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(19_999); });

    payment.checkoutType = "success";
    view.rerender(loadingPayment());
    await act(async () => {});
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByText("Secure payment fields")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete purchase" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reload secure payment" })).not.toBeInTheDocument();
    expect(payment.initialize).toHaveBeenCalledTimes(1);
    expect(payment.confirm).not.toHaveBeenCalled();
  });

  it("clears the initialization timer when checkout unmounts", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    payment.checkoutType = "loading";
    const view = render(loadingPayment());
    await act(async () => {});
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(payment.initialize).toHaveBeenCalledTimes(1);
    expect(payment.confirm).not.toHaveBeenCalled();
  });

  it.each(["decline", "network"] as const)(
    "deduplicates pending submits and safely retries a %s failure on the same checkout",
    async (failure) => {
      const first = pendingConfirmation();
      const retry = pendingConfirmation();
      payment.confirm
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(retry.promise);
      const onConfirm = vi.fn();
      render(
        <EmbeddedPayment
          accessToken="local-fixture-access"
          caseId="33333333-3333-4333-8333-333333333333"
          onConfirm={onConfirm}
          userId="22222222-2222-4222-8222-222222222222"
        />,
      );

      const button = await screen.findByRole("button", { name: "Complete purchase" });
      await waitFor(() => expect(button).toBeEnabled());
      const form = button.closest("form");
      if (!form) throw new Error("The purchase button must belong to the payment form.");

      act(() => {
        fireEvent.submit(form);
        fireEvent.submit(form);
      });
      expect(payment.confirm).toHaveBeenCalledTimes(1);
      expect(payment.confirm).toHaveBeenLastCalledWith({ redirect: "if_required" });
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent("Confirming payment");
      expect(onConfirm).not.toHaveBeenCalled();

      await act(async () => {
        if (failure === "decline") {
          first.resolve({ type: "error", error: { message: "Your test card was declined." } });
        } else {
          first.reject(new Error("Local fixture connection failure"));
        }
      });
      expect(screen.getByRole("alert")).toHaveTextContent(
        failure === "decline"
          ? "Your test card was declined."
          : "We couldn’t confirm payment. Your saved checkout can be retried safely.",
      );
      expect(button).toBeEnabled();
      expect(onConfirm).not.toHaveBeenCalled();

      act(() => {
        fireEvent.submit(form);
        fireEvent.submit(form);
      });
      expect(payment.confirm).toHaveBeenCalledTimes(2);
      expect(button).toBeDisabled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(payment.initialize).toHaveBeenCalledTimes(1);

      await act(async () => { retry.resolve({ type: "success" }); });
      expect(onConfirm).toHaveBeenCalledExactlyOnceWith("cs_test_duplicate_submit");
      expect(button).toBeDisabled();
      fireEvent.submit(form);
      expect(payment.confirm).toHaveBeenCalledTimes(2);
      expect(payment.initialize).toHaveBeenCalledTimes(1);
    },
  );
});
