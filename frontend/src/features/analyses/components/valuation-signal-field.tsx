import { useEffect, useRef } from "react";

type Signal = {
  startX: number;
  startY: number;
  angle: number;
  orbit: number;
  stretch: number;
  drift: number;
  delay: number;
  duration: number;
  gathers: boolean;
  depth: number;
  radius: number;
  opacity: number;
  color: string;
  shiftX: number;
  shiftY: number;
  velocityX: number;
  velocityY: number;
};

const SIGNAL_COLORS = ["64, 108, 123", "82, 118, 128", "97, 123, 132", "60, 119, 118"];
const TAU = Math.PI * 2;

function createSignals(count: number): Signal[] {
  let seed = 41357;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  return Array.from({ length: count }, () => {
    const depth = random();
    return {
      startX: random(),
      startY: random(),
      angle: random() * TAU,
      orbit: 0.42 + random() ** 1.3 * 0.86,
      stretch: 0.8 + random() * 0.42,
      drift: random() * TAU,
      delay: 0.25 + random() * 1.45,
      duration: 4.4 + random() * 2.1,
      gathers: random() < 0.72,
      depth,
      radius: 0.45 + depth ** 2.5 * 1.12,
      opacity: 0.2 + depth * 0.4,
      color: SIGNAL_COLORS[Math.floor(random() * SIGNAL_COLORS.length)],
      shiftX: 0,
      shiftY: 0,
      velocityX: 0,
      velocityY: 0,
    };
  });
}

function smoothStep(start: number, end: number, value: number) {
  const amount = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return amount * amount * (3 - 2 * amount);
}

export function ValuationSignalField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    let width = 0;
    let height = 0;
    let left = 0;
    let top = 0;
    let elapsed = reducedMotion.matches ? 12 : 0;
    let previousFrame = 0;
    let frame: number | null = null;
    let inView = true;
    let signals: Signal[] = [];
    let disposed = false;
    const pointer = { x: 0, y: 0, followX: 0, followY: 0, active: false };

    const draw = (delta: number) => {
      context.clearRect(0, 0, width, height);
      const centerX = width * 0.5;
      const centerY = height * 0.48;
      const quietWidth = Math.min(260, width * 0.36);
      const quietHeight = width < 640 ? 46 : 32;
      const orbitWidth = Math.min(430, width * (width < 640 ? 0.57 : 0.34));
      const orbitHeight = Math.min(220, height * 0.24);
      const interactionRadius = 210;
      const cursorEase = 1 - Math.exp(-12 * delta);
      pointer.followX += (pointer.x - pointer.followX) * cursorEase;
      pointer.followY += (pointer.y - pointer.followY) * cursorEase;

      for (const signal of signals) {
        const time = elapsed;
        const angle = signal.angle + time * (0.027 + signal.depth * 0.026)
          + Math.sin(time * 0.075 + signal.drift) * 0.12;
        const breathe = Math.sin(time * 0.09 + signal.drift) * 0.08;
        const excursion = signal.depth < 0.16
          ? ((Math.sin(time * 0.045 + signal.drift) + 1) / 2) ** 5 * 0.65
          : 0;
        const orbit = signal.orbit + breathe + excursion;
        const orbitX = centerX + Math.cos(angle) * orbitWidth * orbit * signal.stretch
          + Math.sin(angle * 2 + signal.drift) * 18;
        const orbitY = centerY + Math.sin(angle) * orbitHeight * orbit / signal.stretch
          + Math.cos(angle * 3 + signal.drift) * 14;
        const gather = signal.gathers ? smoothStep(signal.delay, signal.delay + signal.duration, time) : 0;
        const startX = signal.startX * width;
        const startY = signal.startY * height;
        const curve = Math.sin(gather * Math.PI);
        const backgroundX = startX + Math.sin(time * 0.04 + signal.drift) * 16 - Math.sin(signal.drift) * 16;
        const backgroundY = startY + Math.cos(time * 0.035 + signal.drift) * 20 - Math.cos(signal.drift) * 20;
        const x = backgroundX * (1 - gather) + orbitX * gather - (startY - centerY) * 0.13 * curve;
        const y = backgroundY * (1 - gather) + orbitY * gather + (startX - centerX) * 0.085 * curve;
        let targetX = 0;
        let targetY = 0;

        if (pointer.active && !reducedMotion.matches) {
          const dx = pointer.followX - x;
          const dy = pointer.followY - y;
          const separation = Math.hypot(dx, dy);
          if (separation < interactionRadius) {
            // Each dot retains its own orbit; the pointer only bends a local section of the field.
            const pull = (1 - smoothStep(12, interactionRadius, separation)) * (0.72 + signal.depth * 0.18);
            targetX = dx * pull;
            targetY = dy * pull;
          }
        }

        if (delta > 0) {
          const damping = Math.exp(-8 * delta);
          signal.velocityX = (signal.velocityX + (targetX - signal.shiftX) * 42 * delta) * damping;
          signal.velocityY = (signal.velocityY + (targetY - signal.shiftY) * 42 * delta) * damping;
          signal.shiftX += signal.velocityX * delta;
          signal.shiftY += signal.velocityY * delta;
        }

        const drawX = x + signal.shiftX;
        const drawY = y + signal.shiftY;
        if (drawX < -3 || drawX > width + 3 || drawY < -3 || drawY > height + 3) continue;

        const quietDistance = ((Math.abs(drawX - centerX) / quietWidth) ** 4
          + (Math.abs(drawY - centerY) / quietHeight) ** 4) ** 0.25;
        const centerFade = smoothStep(0.8, 1.35, quietDistance);
        const opacity = signal.opacity * centerFade * (signal.gathers ? 1 : 0.7);
        if (opacity < 0.008) continue;

        context.beginPath();
        context.fillStyle = `rgba(${signal.color}, ${opacity})`;
        context.arc(drawX, drawY, signal.radius, 0, TAU);
        context.fill();
      }
    };

    const stop = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      previousFrame = 0;
    };

    const animate = (timestamp: number) => {
      frame = null;
      if (disposed || document.hidden || !inView || reducedMotion.matches) return;
      const delta = previousFrame ? Math.min((timestamp - previousFrame) / 1000, 0.05) : 0;
      previousFrame = timestamp;
      elapsed += delta;
      draw(delta);
      frame = window.requestAnimationFrame(animate);
    };

    const syncAnimation = () => {
      stop();
      if (disposed || document.hidden || !inView || width === 0 || height === 0) return;
      if (reducedMotion.matches) {
        for (const signal of signals) {
          signal.shiftX = 0;
          signal.shiftY = 0;
          signal.velocityX = 0;
          signal.velocityY = 0;
        }
        draw(0);
      } else {
        frame = window.requestAnimationFrame(animate);
      }
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      left = bounds.left;
      top = bounds.top;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      const count = Math.min(2600, Math.max(850, Math.round(width * height / 520)));
      if (signals.length !== count) signals = createSignals(count);
      draw(0);
      syncAnimation();
    };

    const movePointer = (event: PointerEvent) => {
      if (!finePointer.matches || event.pointerType !== "mouse" || reducedMotion.matches) return;
      pointer.x = event.clientX - left;
      pointer.y = event.clientY - top;
      if (!pointer.active) {
        pointer.followX = pointer.x;
        pointer.followY = pointer.y;
      }
      pointer.active = pointer.x >= 0 && pointer.x <= width && pointer.y >= 0 && pointer.y <= height;
    };
    const clearPointer = () => { pointer.active = false; };
    const leaveWindow = (event: PointerEvent) => {
      if (!event.relatedTarget) clearPointer();
    };
    const changeMotion = () => {
      clearPointer();
      syncAnimation();
    };
    const changeVisibility = () => {
      clearPointer();
      syncAnimation();
    };

    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    const intersectionObserver = typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(([entry]) => {
          inView = entry.isIntersecting;
          syncAnimation();
        })
      : null;

    resizeObserver?.observe(canvas);
    intersectionObserver?.observe(canvas);
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", movePointer, { passive: true });
    window.addEventListener("pointerout", leaveWindow, { passive: true });
    window.addEventListener("pointercancel", clearPointer, { passive: true });
    window.addEventListener("blur", clearPointer);
    document.addEventListener("visibilitychange", changeVisibility);
    reducedMotion.addEventListener("change", changeMotion);
    finePointer.addEventListener("change", clearPointer);
    resize();

    return () => {
      disposed = true;
      stop();
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", movePointer);
      window.removeEventListener("pointerout", leaveWindow);
      window.removeEventListener("pointercancel", clearPointer);
      window.removeEventListener("blur", clearPointer);
      document.removeEventListener("visibilitychange", changeVisibility);
      reducedMotion.removeEventListener("change", changeMotion);
      finePointer.removeEventListener("change", clearPointer);
    };
  }, []);

  return <canvas ref={canvasRef} className="valuation-signal-field" aria-hidden="true"
    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />;
}
