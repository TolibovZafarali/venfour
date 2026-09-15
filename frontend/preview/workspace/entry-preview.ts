export const entryPreviewModes = ["fast", "slow", "hold", "new"] as const;
export type EntryPreviewMode = typeof entryPreviewModes[number];
const requested = new URLSearchParams(location.search).get("previewEntry");
export const entryPreviewMode = entryPreviewModes.find(mode => mode === requested);

let release: (() => void) | undefined;
let pending: Promise<void> | undefined;

export function waitForEntryPreview() {
  if (!entryPreviewMode) return Promise.resolve();
  pending ??= new Promise<void>(resolve => {
    release = resolve;
    if (entryPreviewMode !== "hold") window.setTimeout(resolve, entryPreviewMode === "fast" ? 120 : 2500);
  });
  return pending;
}

export function continueEntryPreview() { release?.(); }

export function entryPreviewHref(mode: EntryPreviewMode) {
  return mode === "new"
    ? "/start?service=total-loss&entry=resume&previewEntry=new"
    : `/app?previewEntry=${mode}`;
}
