import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EmbeddedPayment } from "./embedded-payment";

const payment = vi.hoisted(() => ({
  confirm: vi.fn(),
  initialize: vi.fn(),
  loadStripe: vi.fn(async () => ({})),
  billingReady: true,
  billingOptions: vi.fn(),
  providerOptions: vi.fn(),
  paymentOptions: vi.fn(),
  checkoutType: "success" as "loading" | "success",
}));

vi.mock("@stripe/stripe-js/pure", () => ({ loadStripe: payment.loadStripe }));
vi.mock("@stripe/react-stripe-js/checkout", async () => {
  const { useEffect } = await import("react");
  return {
    CheckoutElementsProvider: ({ children, options }: { children: ReactNode; options: unknown }) => {
      payment.providerOptions(options);
      return <div data-testid="stripe-checkout-elements">{children}</div>;
    },
    BillingAddressElement: ({ onReady, onLoadError, options }: { onReady: () => void; onLoadError: () => void; options: unknown }) => {
      payment.billingOptions(options);
      useEffect(() => { if (payment.billingReady) onReady(); }, [onReady]);
      return <div>Secure billing fields<button type="button" onClick={onLoadError}>Simulate billing load failure</button></div>;
    },
    PaymentElement: ({ onReady, options }: { onReady: () => void; options: unknown }) => {
      payment.paymentOptions(options);
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
    payment.billingReady = true;
    payment.billingOptions.mockClear();
    payment.providerOptions.mockClear();
    payment.paymentOptions.mockClear();
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
    document.documentElement.style.removeProperty("--primary");
  });

  const loadingPayment = () => (
    <EmbeddedPayment
      accessToken="local-fixture-access"
      caseId="33333333-3333-4333-8333-333333333333"
      onConfirm={vi.fn()}
      userId="22222222-2222-4222-8222-222222222222"
    />
  );

  it("shares one Stripe checkout provider for billing and payment, with an editable U.S. country default", async () => {
    const view = render(loadingPayment());
    expect(await screen.findByText("Secure billing fields")).toBeVisible();
    expect(payment.billingOptions).toHaveBeenCalledWith({ display: { name: "full" } });
    expect(payment.paymentOptions).toHaveBeenCalledWith(expect.objectContaining({
      fields: { billingDetails: "never" },
      layout: { type: "tabs" },
    }));
    const [provider] = screen.getAllByTestId("stripe-checkout-elements");
    expect(screen.getAllByTestId("stripe-checkout-elements")).toHaveLength(1);
    expect(within(provider).getByText("Secure billing fields")).toBeVisible();
    expect(within(provider).getByText("Secure payment fields")).toBeVisible();
    expect(payment.providerOptions).toHaveBeenCalledWith(expect.objectContaining({
      defaultValues: { billingAddress: { address: { country: "US" } } },
      elementsOptions: expect.objectContaining({ syncAddressCheckbox: "none" }),
    }));
    expect(view.container.querySelector("input")).toBeNull();
    expect(payment.confirm).not.toHaveBeenCalled();
  });

  it("uses the app primary color for Stripe accents and focus with neutral supporting fields", async () => {
    document.documentElement.style.setProperty("--primary", "#1d4ed8");
    render(loadingPayment());
    await screen.findByText("Secure billing fields");
    expect(payment.providerOptions).toHaveBeenCalledWith(expect.objectContaining({
      elementsOptions: expect.objectContaining({
        appearance: expect.objectContaining({
          variables: expect.objectContaining({
            colorPrimary: "#1d4ed8",
            colorText: "#171717",
            colorDanger: "#404040",
            colorBackground: "#ffffff",
          }),
          rules: expect.objectContaining({
            ".Input:focus": { borderColor: "#1d4ed8", boxShadow: "0 0 0 1px #1d4ed8" },
          }),
        }),
      }),
    }));
  });

  it("blocks confirmation until both Elements are ready and after a billing load failure", async () => {
    payment.billingReady = false;
    const view = render(loadingPayment());
    const button = await screen.findByRole("button", { name: "Complete purchase" });
    expect(button).toBeDisabled();
    fireEvent.submit(button.closest("form")!);
    expect(payment.confirm).not.toHaveBeenCalled();
    payment.billingReady = true;
    view.rerender(loadingPayment());
    await waitFor(() => expect(button).toBeEnabled());
    payment.billingReady = false;
    fireEvent.click(screen.getByRole("button", { name: "Simulate billing load failure" }));
    expect(button).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Billing fields could not load");
    fireEvent.submit(button.closest("form")!);
    expect(payment.confirm).not.toHaveBeenCalled();
  });

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
