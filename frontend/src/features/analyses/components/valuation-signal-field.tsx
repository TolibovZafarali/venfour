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
  captured: boolean;
  influence: number;
  capturedAt: number;
  lastNearPointer: number;
  recaptureAfter: number;
  wellX: number;
  wellY: number;
  wellAngle: number;
  drawX: number;
  drawY: number;
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
      captured: false,
      influence: 0,
      capturedAt: 0,
      lastNearPointer: 0,
      recaptureAfter: 0,
      wellX: 0,
      wellY: 0,
      wellAngle: 0,
      drawX: 0,
      drawY: 0,
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
    const pointer = { x: 0, y: 0, followX: 0, followY: 0, velocityX: 0, velocityY: 0, active: false };

    const draw = (delta: number) => {
      context.clearRect(0, 0, width, height);
      const centerX = width * 0.5;
      const centerY = height * 0.48;
      const quietWidth = Math.min(260, width * 0.36);
      const quietHeight = width < 640 ? 46 : 32;
      const orbitWidth = Math.min(430, width * (width < 640 ? 0.57 : 0.34));
      const orbitHeight = Math.min(220, height * 0.24);
      const interactionRadius = 245;
      const cursorEase = 1 - Math.exp(-20 * delta);
      const previousPointerX = pointer.followX;
      const previousPointerY = pointer.followY;
      pointer.followX += (pointer.x - pointer.followX) * cursorEase;
      pointer.followY += (pointer.y - pointer.followY) * cursorEase;
      if (delta > 0) {
        const velocityEase = 1 - Math.exp(-10 * delta);
        const speedX = (pointer.followX - previousPointerX) / delta;
        const speedY = (pointer.followY - previousPointerY) / delta;
        const limit = Math.min(1, 1800 / Math.max(1, Math.hypot(speedX, speedY)));
        pointer.velocityX += (speedX * limit - pointer.velocityX) * velocityEase;
        pointer.velocityY += (speedY * limit - pointer.velocityY) * velocityEase;
      }

      // Recruitment is local and bounded, leaving the main gathering field populated.
      const captureLimit = Math.min(240, Math.round(signals.length * 0.11));
      let influencedCount = signals.filter((signal) => signal.captured || signal.influence > 0.08).length;
      const neighbors = new Map<string, { signal: Signal; x: number; y: number }[]>();
      for (const signal of signals) {
        if (signal.influence < 0.2) continue;
        const key = `${Math.floor(signal.drawX / 8)},${Math.floor(signal.drawY / 8)}`;
        const cell = neighbors.get(key);
        const neighbor = { signal, x: signal.drawX, y: signal.drawY };
        if (cell) cell.push(neighbor);
        else neighbors.set(key, [neighbor]);
      }

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

        const currentX = x + signal.shiftX;
        const currentY = y + signal.shiftY;
        const pointerDistance = Math.hypot(currentX - pointer.followX, currentY - pointer.followY);
        const pointerEnabled = pointer.active && !reducedMotion.matches;

        if (signal.captured) {
          if (pointerEnabled && pointerDistance < interactionRadius * 1.5) signal.lastNearPointer = time;
          if (!pointerEnabled || time - signal.lastNearPointer > 0.65 || time - signal.capturedAt > 9 + signal.depth * 8) {
            signal.captured = false;
            signal.recaptureAfter = time + 2;
          }
        } else if (pointerEnabled && signal.influence < 0.08 && time > signal.recaptureAfter
          && influencedCount < captureLimit && pointerDistance < interactionRadius * (0.72 + signal.depth * 0.28)) {
          signal.captured = true;
          signal.capturedAt = time;
          signal.lastNearPointer = time;
          signal.wellX = pointer.followX;
          signal.wellY = pointer.followY;
          signal.wellAngle = Math.atan2(currentY - pointer.followY, currentX - pointer.followX);
          influencedCount += 1;
        }

        const influenceRate = signal.captured ? 7 + signal.depth * 8 : 1.5 + signal.depth * 0.7;
        signal.influence += ((signal.captured ? 1 : 0) - signal.influence) * (1 - Math.exp(-influenceRate * delta));
        if (signal.influence > 0.001) {
          if (signal.captured) {
            const follow = 1 - Math.exp(-(8 + signal.depth * 20) * delta);
            signal.wellX += (pointer.followX - signal.wellX) * follow;
            signal.wellY += (pointer.followY - signal.wellY) * follow;
          }
          const wellTime = time - signal.capturedAt;
          const wellAngle = signal.wellAngle + wellTime * (0.18 + signal.depth * 0.2);
          const spread = 8 + (signal.drift / TAU) ** 1.25 * 62;
          const breathing = 1 + Math.sin(wellTime * 0.8 + signal.drift) * 0.1;
          const localX = Math.cos(wellAngle) * spread * breathing + Math.sin(wellTime * 1.1 + signal.drift) * 3;
          const localY = Math.sin(wellAngle) * spread * 0.8 * breathing + Math.cos(wellTime * 0.9 + signal.drift) * 3;
          targetX = (signal.wellX + localX - x) * signal.influence;
          targetY = (signal.wellY + localY - y) * signal.influence;
        }

        let separationX = 0;
        let separationY = 0;
        if (signal.influence > 0.2) {
          const cellX = Math.floor(currentX / 8);
          const cellY = Math.floor(currentY / 8);
          for (let column = cellX - 1; column <= cellX + 1; column += 1) {
            for (let row = cellY - 1; row <= cellY + 1; row += 1) {
              for (const neighbor of neighbors.get(`${column},${row}`) ?? []) {
                if (neighbor.signal === signal) continue;
                const dx = currentX - neighbor.x;
                const dy = currentY - neighbor.y;
                const distance = Math.hypot(dx, dy);
                const spacing = 4 + signal.radius + neighbor.signal.radius;
                if (distance > 0.01 && distance < spacing) {
                  const push = (1 - distance / spacing) * 180 * signal.influence;
                  separationX += dx / distance * push;
                  separationY += dy / distance * push;
                }
              }
            }
          }
        }

        if (delta > 0 && (signal.influence > 0.001 || Math.hypot(signal.shiftX, signal.shiftY) > 0.01)) {
          const stiffness = 28 + signal.influence * (66 + signal.depth * 126);
          const drag = 9 + signal.influence * (3 + signal.depth * 9);
          const steps = Math.ceil(delta * 90);
          const step = delta / steps;
          const damping = Math.exp(-drag * step);
          const inherit = signal.captured ? signal.influence * (0.06 + signal.depth * 0.22) : 0;
          for (let iteration = 0; iteration < steps; iteration += 1) {
            signal.velocityX = (signal.velocityX + ((targetX - signal.shiftX) * stiffness + separationX + pointer.velocityX * inherit * drag) * step) * damping;
            signal.velocityY = (signal.velocityY + ((targetY - signal.shiftY) * stiffness + separationY + pointer.velocityY * inherit * drag) * step) * damping;
            const speedLimit = Math.min(1, (1400 + signal.depth * 700) / Math.max(1, Math.hypot(signal.velocityX, signal.velocityY)));
            signal.velocityX *= speedLimit;
            signal.velocityY *= speedLimit;
            signal.shiftX += signal.velocityX * step;
            signal.shiftY += signal.velocityY * step;
          }
        }

        const drawX = x + signal.shiftX;
        const drawY = y + signal.shiftY;
        signal.drawX = drawX;
        signal.drawY = drawY;
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
          signal.captured = false;
          signal.influence = 0;
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
        pointer.velocityX = 0;
        pointer.velocityY = 0;
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
