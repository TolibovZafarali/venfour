import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EmbeddedPayment } from "./embedded-payment";

const payment = vi.hoisted(() => ({
  confirm: vi.fn(),
  initialize: vi.fn(),
  loadStripe: vi.fn(async () => ({})),
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
      type: "success",
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
    payment.confirm.mockReset();
    payment.initialize.mockReset();
    payment.initialize.mockResolvedValue({
      state: "checkout_ready",
      checkoutSessionId: "cs_test_duplicate_submit",
      clientSecret: "cs_test_duplicate_submit" + "_secret_local_fixture",
      publishableKey: "pk_test_" + "local_duplicate_fixture",
    });
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
