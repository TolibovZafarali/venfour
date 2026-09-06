const MAX_DELTA = 1 / 30;
const POINTER_POSITION_TAU = 0.045;
const POINTER_VELOCITY_TAU = 0.06;
const IDLE_GRACE = 0.09;
const IDLE_FADE = 0.15;
const CAPTURE_RADIUS = 200;
const RELEASE_RADIUS = 240;
const ENTER_TAU = 0.12;
const EXIT_TAU = 0.26;
const FOLLOW_OMEGA = 4.8;
const FOLLOW_DAMPING = 1.05;
const VELOCITY_INHERITANCE = 0.55;
const RETURN_OMEGA = 5.2;
const RETURN_DAMPING = 1.05;

export type PointerMotion = {
  rawX: number;
  rawY: number;
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  lastMoveTime: number;
  activity: number;
  idleGate: number;
  directionX: number;
  directionY: number;
  active: boolean;
};

export type SignalMotion = {
  shiftX: number;
  shiftY: number;
  velocityX: number;
  velocityY: number;
  followWeight: number;
  trailOffset: number;
  sideOffset: number;
  strength: number;
  normalX: number;
  normalY: number;
  normalVelocityX: number;
  normalVelocityY: number;
  hasNormalPosition: boolean;
  hasNormalVelocity: boolean;
};

function smoothStep(start: number, end: number, value: number) {
  const amount = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return amount * amount * (3 - 2 * amount);
}

export function createPointerMotion(): PointerMotion {
  return {
    rawX: 0, rawY: 0, x: 0, y: 0, velocityX: 0, velocityY: 0,
    lastMoveTime: -Infinity, activity: 0, idleGate: 0, directionX: 1, directionY: 0, active: false,
  };
}

export function recordPointerMove(pointer: PointerMotion, x: number, y: number, now: number) {
  if (!pointer.active) {
    // Entering establishes a location, without inventing motion across the viewport.
    pointer.rawX = pointer.x = x;
    pointer.rawY = pointer.y = y;
    pointer.velocityX = pointer.velocityY = pointer.activity = pointer.idleGate = 0;
    pointer.lastMoveTime = -Infinity;
    pointer.active = true;
  } else if (x !== pointer.rawX || y !== pointer.rawY) {
    pointer.rawX = x;
    pointer.rawY = y;
    pointer.lastMoveTime = now;
  }
}

export function clearPointerMotion(pointer: PointerMotion) {
  pointer.active = false;
  pointer.lastMoveTime = -Infinity;
  pointer.activity = 0;
  pointer.idleGate = 0;
  pointer.velocityX = pointer.velocityY = 0;
}

export function advancePointerMotion(pointer: PointerMotion, delta: number, now: number) {
  const dt = Math.min(delta, MAX_DELTA);
  if (dt <= 0 || !pointer.active) return;
  const positionAlpha = 1 - Math.exp(-dt / POINTER_POSITION_TAU);
  const dx = (pointer.rawX - pointer.x) * positionAlpha;
  const dy = (pointer.rawY - pointer.y) * positionAlpha;
  pointer.x += dx;
  pointer.y += dy;
  const velocityAlpha = 1 - Math.exp(-dt / POINTER_VELOCITY_TAU);
  pointer.velocityX += (dx / dt - pointer.velocityX) * velocityAlpha;
  pointer.velocityY += (dy / dt - pointer.velocityY) * velocityAlpha;
  const speed = Math.hypot(pointer.velocityX, pointer.velocityY);
  if (speed > 0.01) {
    pointer.directionX = pointer.velocityX / speed;
    pointer.directionY = pointer.velocityY / speed;
  }
  // Wall-clock events gate activity; smoothing the last sample cannot prolong it.
  pointer.idleGate = 1 - smoothStep(IDLE_GRACE, IDLE_GRACE + IDLE_FADE, now - pointer.lastMoveTime);
  pointer.activity = smoothStep(10, 80, speed) * pointer.idleGate;
}

export function createSignalMotion(index: number): SignalMotion {
  // A separate seed leaves the field's authored distribution unchanged.
  let seed = (Math.imul(index + 1, 747796405) + 2891336453) >>> 0;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  return {
    shiftX: 0, shiftY: 0, velocityX: 0, velocityY: 0, followWeight: 0,
    trailOffset: 5 + random() * 25,
    sideOffset: -18 + random() * 36,
    strength: 0.9 + random() * 0.2,
    normalX: 0, normalY: 0, normalVelocityX: 0, normalVelocityY: 0,
    hasNormalPosition: false, hasNormalVelocity: false,
  };
}

export function resetSignalMotion(signal: SignalMotion) {
  signal.shiftX = signal.shiftY = signal.velocityX = signal.velocityY = signal.followWeight = 0;
  signal.hasNormalPosition = signal.hasNormalVelocity = false;
}

export function advanceSignalMotion(
  signal: SignalMotion, pointer: PointerMotion, normalX: number, normalY: number, delta: number,
) {
  const dt = Math.min(delta, MAX_DELTA);
  if (dt <= 0 || !signal.hasNormalPosition) {
    signal.normalX = normalX;
    signal.normalY = normalY;
    signal.normalVelocityX = signal.normalVelocityY = 0;
    signal.hasNormalPosition = true;
    signal.hasNormalVelocity = false;
    return;
  }

  const normalVelocityX = (normalX - signal.normalX) / delta;
  const normalVelocityY = (normalY - signal.normalY) / delta;
  const normalAccelerationX = signal.hasNormalVelocity ? (normalVelocityX - signal.normalVelocityX) / delta : 0;
  const normalAccelerationY = signal.hasNormalVelocity ? (normalVelocityY - signal.normalVelocityY) / delta : 0;
  signal.normalX = normalX;
  signal.normalY = normalY;
  signal.normalVelocityX = normalVelocityX;
  signal.normalVelocityY = normalVelocityY;
  signal.hasNormalVelocity = true;

  const distance = Math.hypot(normalX + signal.shiftX - pointer.x, normalY + signal.shiftY - pointer.y);
  // Existing followers gain a little range gradually, without a capture-edge jump.
  const radius = CAPTURE_RADIUS + (RELEASE_RADIUS - CAPTURE_RADIUS) * smoothStep(0, 0.35, signal.followWeight);
  const proximity = (1 - smoothStep(0, radius, distance)) ** 1.35;
  const activity = pointer.active ? pointer.activity : 0;
  const targetWeight = Math.min(1, proximity * activity * signal.strength);
  const tau = targetWeight > signal.followWeight ? ENTER_TAU : EXIT_TAU;
  signal.followWeight += (targetWeight - signal.followWeight) * (1 - Math.exp(-dt / tau));

  // Residual followWeight must never make a stationary or distant pointer an attractor.
  const cursorBlend = pointer.active
    ? signal.followWeight * pointer.idleGate * (1 - smoothStep(CAPTURE_RADIUS, RELEASE_RADIUS, distance))
    : 0;
  const targetX = pointer.x - pointer.directionX * signal.trailOffset - pointer.directionY * signal.sideOffset;
  const targetY = pointer.y - pointer.directionY * signal.trailOffset + pointer.directionX * signal.sideOffset;
  const targetVelocityX = pointer.velocityX * VELOCITY_INHERITANCE;
  const targetVelocityY = pointer.velocityY * VELOCITY_INHERITANCE;
  const steps = Math.ceil(dt * 120);
  const step = dt / steps;

  for (let iteration = 0; iteration < steps; iteration += 1) {
    const normalForceX = -(RETURN_OMEGA ** 2) * signal.shiftX - 2 * RETURN_DAMPING * RETURN_OMEGA * signal.velocityX;
    const normalForceY = -(RETURN_OMEGA ** 2) * signal.shiftY - 2 * RETURN_DAMPING * RETURN_OMEGA * signal.velocityY;
    const followAccelerationX = FOLLOW_OMEGA ** 2 * (targetX - normalX - signal.shiftX)
      + 2 * FOLLOW_DAMPING * FOLLOW_OMEGA * (targetVelocityX - normalVelocityX - signal.velocityX);
    const followAccelerationY = FOLLOW_OMEGA ** 2 * (targetY - normalY - signal.shiftY)
      + 2 * FOLLOW_DAMPING * FOLLOW_OMEGA * (targetVelocityY - normalVelocityY - signal.velocityY);
    // Integrate displacement relative to the unchanged base path. Its acceleration
    // is already present in the rendered position and must not be counted twice.
    signal.velocityX += (normalForceX * (1 - cursorBlend) + (followAccelerationX - normalAccelerationX) * cursorBlend) * step;
    signal.velocityY += (normalForceY * (1 - cursorBlend) + (followAccelerationY - normalAccelerationY) * cursorBlend) * step;

    const speed = Math.hypot(signal.velocityX, signal.velocityY);
    const softLimit = 400 * signal.strength;
    if (speed > softLimit) {
      const drag = Math.exp(-(speed / softLimit - 1) * 8 * step);
      signal.velocityX *= drag;
      signal.velocityY *= drag;
    }
    signal.shiftX += signal.velocityX * step;
    signal.shiftY += signal.velocityY * step;
  }
}
