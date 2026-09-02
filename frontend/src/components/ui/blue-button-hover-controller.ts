import type { BlueButtonFluidRenderer } from "./blue-button-fluid-renderer";

// Only action elements using the existing solid-blue design tokens participate.
export const blueButtonSelector = ':is(button, a[href], [role="button"]):is(.bg-brand, .bg-primary, [data-slot="button"][data-variant="default"], .review-primary, .request-button-primary)';

interface RendererModule {
  createBlueButtonFluidRenderer(canvas: HTMLCanvasElement): BlueButtonFluidRenderer | null;
}
interface HoverOptions {
  loadRenderer?: () => Promise<RendererModule>;
}

function disabled(target: HTMLElement) {
  return target.matches(':disabled, [aria-disabled="true"], [aria-busy="true"]') || Boolean(target.closest("[inert]"));
}

function blueBackground(target: HTMLElement) {
  const color = getComputedStyle(target).backgroundColor;
  // Tailwind's opacity variants resolve to color(srgb ...) in modern browsers.
  const components = color.match(/^rgba?\(([^)]+)\)$/)?.[1]
    ?? color.match(/^color\(srgb\s+([^)]+)\)$/)?.[1];
  let channels = components?.trim().split(/[,\s/]+/).map(Number);
  if (!channels) {
    // Interrupted color transitions may be reported in Oklab or another color space.
    // Let the browser normalize that one pixel instead of duplicating color math.
    try {
      const probe = document.createElement("canvas");
      probe.width = probe.height = 1;
      const context = probe.getContext("2d", { willReadFrequently: true });
      if (!context) return false;
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
      channels = [red, green, blue, alpha / 255];
    } catch { return false; }
  }
  if (!channels || channels.length < 3) return false;
  const [red, green, blue, alpha = 1] = channels;
  return alpha > .5 && blue > red * 1.25 && blue > green * 1.1;
}

/** One delegated controller also covers newly mounted controls and dialog portals. */
export function installBlueButtonHover({ loadRenderer = () => import("./blue-button-fluid-renderer") }: HoverOptions = {}) {
  const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia?.("(any-hover: hover) and (any-pointer: fine)");
  if (!motion || !finePointer) return () => undefined;

  let mounted = true;
  let animationFrame = 0;
  let previousFrame = 0;
  let renderer: BlueButtonFluidRenderer | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let loading: Promise<void> | null = null;
  let rendererUnavailable = false;
  let active: {
    target: HTMLElement;
    overlay: HTMLSpanElement;
    x: number;
    y: number;
    leavingAt: number | null;
  } | null = null;

  const allowed = () => !motion.matches && finePointer.matches && document.visibilityState !== "hidden";
  const stop = () => {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    previousFrame = 0;
    if (!active) return;
    active.overlay.remove();
    active.target.removeAttribute("data-blue-button-hover");
    active.target.removeAttribute("data-blue-button-position");
    active = null;
  };
  const contextLost = () => {
    rendererUnavailable = true;
    releaseRenderer();
  };
  const releaseRenderer = () => {
    canvas?.removeEventListener("webglcontextlost", contextLost);
    renderer?.dispose();
    renderer = null;
    canvas?.remove();
    canvas = null;
    if (active) active.overlay.dataset.renderer = "fallback";
  };
  const suspend = () => { stop(); releaseRenderer(); };
  const ensureRenderer = () => {
    if (renderer || loading || rendererUnavailable) return;
    loading = loadRenderer().then(({ createBlueButtonFluidRenderer }) => {
      if (!mounted || !active || !allowed()) return;
      canvas = document.createElement("canvas");
      canvas.setAttribute("aria-hidden", "true");
      renderer = createBlueButtonFluidRenderer(canvas);
      if (!renderer) {
        rendererUnavailable = true;
        canvas = null;
        return;
      }
      canvas.addEventListener("webglcontextlost", contextLost);
      active.overlay.append(canvas);
      active.overlay.dataset.renderer = "webgl";
      renderer.move(active.x, active.y);
    }).catch(() => {
      rendererUnavailable = true;
      releaseRenderer();
    }).finally(() => { loading = null; });
  };
  const frame = (now: number) => {
    animationFrame = 0;
    if (!active) return;
    if (!allowed() || !active.target.isConnected || !active.overlay.isConnected || !active.target.matches(blueButtonSelector) || disabled(active.target)) { stop(); return; }
    if (active.leavingAt !== null && now - active.leavingAt >= 420) { stop(); return; }
    const rect = active.target.getBoundingClientRect();
    if (!rect.width || !rect.height) { stop(); return; }
    try {
      renderer?.resize(rect.width, rect.height, window.devicePixelRatio || 1);
      renderer?.render(previousFrame ? (now - previousFrame) / 1000 : 1 / 60, active.leavingAt === null);
    } catch {
      rendererUnavailable = true;
      releaseRenderer();
    }
    previousFrame = now;
    animationFrame = requestAnimationFrame(frame);
  };
  const move = (event: PointerEvent) => {
    if (event.pointerType === "touch") { stop(); return; }
    if (!allowed()) return;
    if (active && !active.overlay.isConnected) stop();
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>(blueButtonSelector) : null;
    if (!target || disabled(target)) return;
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const newHover = !active || active.target !== target || active.leavingAt !== null;
    if (target !== active?.target) {
      if (!blueBackground(target)) return;
      stop();
      const overlay = document.createElement("span");
      overlay.setAttribute("aria-hidden", "true");
      overlay.dataset.blueButtonFluid = "";
      overlay.dataset.renderer = renderer ? "webgl" : "fallback";
      if (getComputedStyle(target).position === "static" || !getComputedStyle(target).position) target.dataset.blueButtonPosition = "static";
      target.dataset.blueButtonHover = "active";
      target.append(overlay);
      if (canvas) overlay.append(canvas);
      active = { target, overlay, x: .5, y: .5, leavingAt: null };
    }
    if (!active) return;
    active.x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    active.y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    active.leavingAt = null;
    active.target.dataset.blueButtonHover = "active";
    active.overlay.style.setProperty("--fluid-x", `${active.x * 100}%`);
    active.overlay.style.setProperty("--fluid-y", `${active.y * 100}%`);
    if (newHover) {
      previousFrame = 0;
      try { renderer?.reset(); }
      catch {
        rendererUnavailable = true;
        releaseRenderer();
      }
    }
    renderer?.move(active.x, active.y);
    ensureRenderer();
    if (!animationFrame) animationFrame = requestAnimationFrame(frame);
  };
  const leave = (event: PointerEvent) => {
    if (!active || !(event.target instanceof Node) || !active.target.contains(event.target)) return;
    if (event.relatedTarget instanceof Node && active.target.contains(event.relatedTarget)) return;
    active.leavingAt = performance.now();
    active.target.dataset.blueButtonHover = "leaving";
  };
  const preferenceChanged = () => {
    suspend();
    rendererUnavailable = false;
  };

  document.addEventListener("pointerover", move, { passive: true });
  document.addEventListener("pointermove", move, { passive: true });
  document.addEventListener("pointerout", leave, { passive: true });
  document.addEventListener("visibilitychange", suspend);
  document.addEventListener("scroll", stop, { capture: true, passive: true });
  window.addEventListener("blur", suspend);
  window.addEventListener("pagehide", suspend);
  motion.addEventListener?.("change", preferenceChanged);
  finePointer.addEventListener?.("change", preferenceChanged);
  return () => {
    mounted = false;
    suspend();
    document.removeEventListener("pointerover", move);
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerout", leave);
    document.removeEventListener("visibilitychange", suspend);
    document.removeEventListener("scroll", stop, true);
    window.removeEventListener("blur", suspend);
    window.removeEventListener("pagehide", suspend);
    motion.removeEventListener?.("change", preferenceChanged);
    finePointer.removeEventListener?.("change", preferenceChanged);
  };
}
