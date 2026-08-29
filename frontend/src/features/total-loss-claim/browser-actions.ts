import type { TotalLossPreparedMessageVersion } from "@/features/total-loss-claim/contracts";

export function formatCommercePrice(
  amountMinorUnits: number | null | undefined,
  currency: string | null | undefined,
  fallback: string | null | undefined,
) {
  if (Number.isSafeInteger(amountMinorUnits) && currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        currency,
        style: "currency",
      }).format(Number(amountMinorUnits) / 100);
    } catch {
      return fallback ?? null;
    }
  }
  return fallback ?? null;
}

export function buildTotalLossMailto(
  message: Pick<
    TotalLossPreparedMessageVersion,
    "body" | "recipient" | "subject"
  >,
) {
  const parameters = new URLSearchParams({
    body: message.body,
    subject: message.subject,
  });
  return `mailto:${encodeURIComponent(message.recipient)}?${parameters.toString()}`;
}

export function openHostedCheckout(url: string) {
  window.location.assign(url);
}

export function openDefaultEmailApp(mailto: string) {
  window.location.assign(mailto);
}

export function openPublishedReport(
  url: string,
  suggestedFilename: string,
  preview: boolean,
) {
  const anchor = document.createElement("a");
  if (preview) {
    const previewUrl = new URL(url);
    previewUrl.searchParams.delete("download");
    anchor.href = previewUrl.toString();
  } else {
    anchor.href = url;
  }
  anchor.rel = "noopener noreferrer";
  if (preview) {
    anchor.target = "_blank";
  } else {
    anchor.download = suggestedFilename;
  }
  anchor.click();
}

export async function copyPreparedEmail(
  message: Pick<TotalLossPreparedMessageVersion, "body" | "subject">,
) {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Copying is unavailable in this browser.");
  }
  await navigator.clipboard.writeText(
    `Subject: ${message.subject}\n\n${message.body}`,
  );
}
