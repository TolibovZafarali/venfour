const MAX_DELTA = 1 / 30;
const TRAIL_CAPACITY = 64;
const TRAIL_DURATION = 0.38;
const CAPTURE_DISTANCE = 72;
const MAX_FOLLOWERS = 36;
const RELEASE_DURATION = 0.24;
const WAYPOINT_LOOKAHEAD = 42;
const VELOCITY_RESPONSE = 0.025;
const RETURN_OMEGA = 5.2;
const RETURN_DAMPING = 1.05;

type TrailSample = { x: number; y: number; rawX: number; rawY: number; time: number };

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
  now: number;
  eventVersion: number;
  sampledVersion: number;
  captureAllowed: boolean;
  captureSlots: number;
  trail: TrailSample[];
  trailStart: number;
  trailCount: number;
};

export type SignalMotion = {
  shiftX: number;
  shiftY: number;
  velocityX: number;
  velocityY: number;
  followWeight: number;
  emphasis: number;
  followDelay: number;
  velocityInheritance: number;
  sideOffset: number;
  strength: number;
  responseTime: number;
  maxSpeed: number;
  lifetime: number;
  captured: boolean;
  captureTime: number;
  captureStrength: number;
  captureSide: number;
  releaseTime: number;
  releaseProgress: number;
  releaseWeight: number;
  recaptureAfter: number;
  trailTime: number;
  pathX: number;
  pathY: number;
  pathDirectionX: number;
  pathDirectionY: number;
  pathSpeed: number;
  targetX: number;
  targetY: number;
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

function trailSample(pointer: PointerMotion, index: number) {
  return pointer.trail[(pointer.trailStart + index) % TRAIL_CAPACITY];
}

function appendTrail(pointer: PointerMotion, now: number) {
  if (pointer.trailCount === TRAIL_CAPACITY) {
    pointer.trailStart = (pointer.trailStart + 1) % TRAIL_CAPACITY;
    pointer.trailCount -= 1;
  }
  const sample = trailSample(pointer, pointer.trailCount);
  sample.x = pointer.x;
  sample.y = pointer.y;
  sample.rawX = pointer.rawX;
  sample.rawY = pointer.rawY;
  sample.time = now;
  pointer.trailCount += 1;
}

export function createPointerMotion(): PointerMotion {
  return {
    rawX: 0, rawY: 0, x: 0, y: 0, velocityX: 0, velocityY: 0,
    lastMoveTime: -Infinity, activity: 0, idleGate: 0, directionX: 1, directionY: 0, active: false,
    now: 0, eventVersion: 0, sampledVersion: 0, captureAllowed: false, captureSlots: MAX_FOLLOWERS,
    trail: Array.from({ length: TRAIL_CAPACITY }, () => ({ x: 0, y: 0, rawX: 0, rawY: 0, time: 0 })),
    trailStart: 0, trailCount: 0,
  };
}

export function recordPointerMove(pointer: PointerMotion, x: number, y: number, now: number) {
  if (!pointer.active) {
    // Entering establishes a location without drawing a path across the viewport.
    pointer.rawX = pointer.x = x;
    pointer.rawY = pointer.y = y;
    pointer.velocityX = pointer.velocityY = pointer.activity = pointer.idleGate = 0;
    pointer.lastMoveTime = -Infinity;
    pointer.sampledVersion = pointer.eventVersion;
    pointer.captureAllowed = false;
    pointer.active = true;
    pointer.trailStart = pointer.trailCount = 0;
    appendTrail(pointer, now);
  } else if (x !== pointer.rawX || y !== pointer.rawY) {
    const distance = Math.hypot(x - pointer.rawX, y - pointer.rawY);
    pointer.directionX = (x - pointer.rawX) / distance;
    pointer.directionY = (y - pointer.rawY) / distance;
    pointer.rawX = x;
    pointer.rawY = y;
    pointer.lastMoveTime = now;
    pointer.eventVersion += 1;
  }
}

export function clearPointerMotion(pointer: PointerMotion) {
  pointer.active = false;
  pointer.lastMoveTime = -Infinity;
  pointer.activity = pointer.idleGate = 0;
  pointer.velocityX = pointer.velocityY = 0;
  pointer.captureAllowed = false;
  pointer.trailStart = pointer.trailCount = 0;
}

export function advancePointerMotion(pointer: PointerMotion, delta: number, now: number, signals: readonly SignalMotion[]) {
  const dt = Math.min(delta, MAX_DELTA);
  pointer.now = now;
  pointer.captureAllowed = false;
  pointer.captureSlots = MAX_FOLLOWERS;
  for (const signal of signals) {
    if (signal.captured || signal.followWeight > 0) pointer.captureSlots -= 1;
  }
  while (pointer.trailCount > 1 && trailSample(pointer, 1).time < now - TRAIL_DURATION) {
    pointer.trailStart = (pointer.trailStart + 1) % TRAIL_CAPACITY;
    pointer.trailCount -= 1;
  }
  if (dt <= 0 || !pointer.active) return;
  const positionAlpha = 1 - Math.exp(-dt / 0.012);
  const dx = (pointer.rawX - pointer.x) * positionAlpha;
  const dy = (pointer.rawY - pointer.y) * positionAlpha;
  pointer.x += dx;
  pointer.y += dy;
  const velocityAlpha = 1 - Math.exp(-dt / 0.02);
  pointer.velocityX += (dx / dt - pointer.velocityX) * velocityAlpha;
  pointer.velocityY += (dy / dt - pointer.velocityY) * velocityAlpha;
  const speed = Math.hypot(pointer.velocityX, pointer.velocityY);
  pointer.idleGate = 1 - smoothStep(0.09, 0.24, now - pointer.lastMoveTime);
  pointer.activity = smoothStep(4, 28, speed) * pointer.idleGate;
  const freshMovement = pointer.eventVersion !== pointer.sampledVersion;
  pointer.sampledVersion = pointer.eventVersion;
  const last = pointer.trailCount ? trailSample(pointer, pointer.trailCount - 1) : null;
  if (freshMovement) {
    // Keep the first stroke after a pause eligible in the same frame.
    if (last && last.time < now - TRAIL_DURATION) last.time = now - dt;
    appendTrail(pointer, now);
  }
  // Crossing uses actual movement; smoothing only shapes the followers' path.
  pointer.captureAllowed = freshMovement && pointer.trailCount > 1;
}

export function createSignalMotion(index: number): SignalMotion {
  // A separate seed leaves the field's authored distribution unchanged.
  let seed = (Math.imul(index + 1, 747796405) + 2891336453) >>> 0;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  return {
    shiftX: 0, shiftY: 0, velocityX: 0, velocityY: 0, followWeight: 0, emphasis: 0,
    followDelay: 0.02 + (random() + random()) * 0.03,
    velocityInheritance: 0.35 + random() * 0.15,
    sideOffset: -8 + random() * 16,
    strength: 0.96 + random() * 0.08,
    responseTime: 0.09 + random() * 0.07,
    maxSpeed: 210 + random() * 60,
    lifetime: 0.32 + random() * 0.16,
    captured: false, captureTime: 0, captureStrength: 0, captureSide: 0,
    releaseTime: 0, releaseProgress: 1, releaseWeight: 0, recaptureAfter: 0,
    trailTime: 0, pathX: 0, pathY: 0, pathDirectionX: 1, pathDirectionY: 0, pathSpeed: 0, targetX: 0, targetY: 0,
    normalX: 0, normalY: 0, normalVelocityX: 0, normalVelocityY: 0,
    hasNormalPosition: false, hasNormalVelocity: false,
  };
}

export function resetSignalMotion(signal: SignalMotion) {
  signal.shiftX = signal.shiftY = signal.velocityX = signal.velocityY = signal.followWeight = signal.emphasis = 0;
  signal.captured = false;
  signal.releaseProgress = 1;
  signal.recaptureAfter = 0;
  signal.hasNormalPosition = signal.hasNormalVelocity = false;
}

function captureFromTrail(signal: SignalMotion, pointer: PointerMotion, x: number, y: number) {
  if (!pointer.captureAllowed || pointer.captureSlots <= 0 || pointer.now < signal.recaptureAfter) return;
  if ((x - pointer.rawX) * pointer.directionX + (y - pointer.rawY) * pointer.directionY > 0) return;
  // Only the newly crossed segment picks up dots; older samples steer existing followers.
  const from = trailSample(pointer, pointer.trailCount - 2);
  const to = trailSample(pointer, pointer.trailCount - 1);
  const dx = to.rawX - from.rawX;
  const dy = to.rawY - from.rawY;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 0.01) return;
  const projection = ((x - from.rawX) * dx + (y - from.rawY) * dy) / lengthSquared;
  // Unclamped projection excludes the forward endpoint's circular capture area.
  if (projection < 0 || projection > 1) return;
  const distance = Math.hypot(x - from.rawX - dx * projection, y - from.rawY - dy * projection);
  const strength = (1 - smoothStep(12, CAPTURE_DISTANCE, distance)) * signal.strength;
  if (strength < 0.08) return;
  const hitX = from.x + (to.x - from.x) * projection;
  const hitY = from.y + (to.y - from.y) * projection;
  const length = Math.sqrt(lengthSquared);
  const directionX = dx / length;
  const directionY = dy / length;
  signal.captured = true;
  signal.captureTime = pointer.now;
  signal.captureStrength = Math.min(1, strength);
  signal.releaseProgress = 0;
  signal.trailTime = from.time + (to.time - from.time) * projection;
  signal.pathX = hitX;
  signal.pathY = hitY;
  signal.pathDirectionX = directionX;
  signal.pathDirectionY = directionY;
  signal.pathSpeed = length / Math.max(1 / 240, to.time - from.time);
  signal.captureSide = -(x - hitX) * directionY + (y - hitY) * directionX;
  signal.targetX = x;
  signal.targetY = y;
  pointer.captureSlots -= 1;
}

function releaseSignal(signal: SignalMotion, now: number) {
  signal.captured = false;
  signal.releaseTime = now;
  signal.releaseWeight = signal.followWeight;
  signal.recaptureAfter = now + RELEASE_DURATION + 0.12;
}

function advanceTrailTarget(signal: SignalMotion, pointer: PointerMotion, x: number, y: number, dt: number) {
  if (pointer.trailCount < 2 || signal.trailTime < trailSample(pointer, 0).time) return false;
  const delayedTime = Math.min(pointer.now - signal.followDelay, trailSample(pointer, pointer.trailCount - 1).time);
  let distanceBudget = Math.min(signal.maxSpeed * dt,
    Math.max(0, WAYPOINT_LOOKAHEAD - Math.hypot(signal.targetX - x, signal.targetY - y)));
  // Consume intervening segments in order. A delayed endpoint alone would cut corners.
  for (let index = 1; index < pointer.trailCount && distanceBudget > 0 && signal.trailTime < delayedTime; index += 1) {
    const from = trailSample(pointer, index - 1);
    const to = trailSample(pointer, index);
    if (to.time <= signal.trailTime) continue;
    const endTime = Math.min(to.time, delayedTime);
    const fraction = Math.max(0, Math.min(1, (endTime - from.time) / (to.time - from.time)));
    const endX = from.x + (to.x - from.x) * fraction;
    const endY = from.y + (to.y - from.y) * fraction;
    const dx = endX - signal.pathX;
    const dy = endY - signal.pathY;
    const distance = Math.hypot(dx, dy);
    const amount = distance > 0 ? Math.min(1, distanceBudget / distance) : 1;
    signal.pathX += dx * amount;
    signal.pathY += dy * amount;
    signal.trailTime += (endTime - signal.trailTime) * amount;
    distanceBudget -= distance * amount;
    const segmentLength = Math.hypot(to.x - from.x, to.y - from.y);
    if (segmentLength > 0) {
      signal.pathDirectionX = (to.x - from.x) / segmentLength;
      signal.pathDirectionY = (to.y - from.y) / segmentLength;
      signal.pathSpeed = segmentLength / Math.max(1 / 240, to.time - from.time);
    }
    if (amount < 1) break;
  }
  const pickup = smoothStep(0, 0.12, pointer.now - signal.captureTime);
  const side = signal.captureSide * (1 - pickup) + signal.sideOffset * pickup;
  signal.targetX = signal.pathX - signal.pathDirectionY * side;
  signal.targetY = signal.pathY + signal.pathDirectionX * side;
  return true;
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

  const x = normalX + signal.shiftX;
  const y = normalY + signal.shiftY;
  if (!signal.captured && signal.followWeight === 0) captureFromTrail(signal, pointer, x, y);
  if (signal.captured || signal.followWeight > 0) {
    const hasPath = advanceTrailTarget(signal, pointer, x, y, dt);
    const distanceBehind = Math.hypot(pointer.rawX - x, pointer.rawY - y);
    const age = pointer.now - signal.captureTime;
    if (signal.captured && (!hasPath || !pointer.active || pointer.now - pointer.lastMoveTime > 0.14
      || age >= signal.lifetime || (distanceBehind > 240 && age >= 0.08))) {
      releaseSignal(signal, pointer.now);
    }
    if (signal.captured) {
      // Even a quick sweep gets a brief pickup before distance starts releasing it.
      const distanceRelease = smoothStep(0.06, 0.14, age) * smoothStep(160, 240, distanceBehind);
      const targetWeight = signal.captureStrength * (1 - distanceRelease);
      signal.followWeight += (targetWeight - signal.followWeight) * (1 - Math.exp(-dt / 0.035));
    } else {
      signal.releaseProgress = Math.min(1, (pointer.now - signal.releaseTime) / RELEASE_DURATION);
      signal.followWeight = signal.releaseWeight * (1 - smoothStep(0, 1, signal.releaseProgress));
    }
  }

  const emphasis = signal.captured ? signal.followWeight * pointer.activity : 0;
  signal.emphasis += (emphasis - signal.emphasis) * (1 - Math.exp(-dt / (emphasis > signal.emphasis ? 0.04 : 0.1)));

  // Stop integrating imperceptible residual motion once the wake has fully released.
  if (signal.followWeight === 0 && Math.hypot(signal.shiftX, signal.shiftY) < 0.0001
    && Math.hypot(signal.velocityX, signal.velocityY) < 0.001) {
    signal.shiftX = signal.shiftY = signal.velocityX = signal.velocityY = 0;
    return;
  }
  const steps = Math.ceil(dt * 120);
  const step = dt / steps;
  for (let iteration = 0; iteration < steps; iteration += 1) {
    const normalForceX = -(RETURN_OMEGA ** 2) * signal.shiftX - 2 * RETURN_DAMPING * RETURN_OMEGA * signal.velocityX;
    const normalForceY = -(RETURN_OMEGA ** 2) * signal.shiftY - 2 * RETURN_DAMPING * RETURN_OMEGA * signal.velocityY;
    let desiredX = (signal.targetX - normalX - signal.shiftX) / signal.responseTime;
    let desiredY = (signal.targetY - normalY - signal.shiftY) / signal.responseTime;
    // Inherit the crossed segment's tangent, including at bends, with a bounded kick.
    const inheritedSpeed = Math.min(520, signal.pathSpeed) * signal.velocityInheritance * pointer.idleGate;
    desiredX += signal.pathDirectionX * inheritedSpeed;
    desiredY += signal.pathDirectionY * inheritedSpeed;
    const desiredSpeed = Math.hypot(desiredX, desiredY);
    const slow = desiredSpeed > 0 ? signal.maxSpeed * Math.tanh(desiredSpeed / signal.maxSpeed) / desiredSpeed : 1;
    desiredX *= slow;
    desiredY *= slow;
    const followAccelerationX = (desiredX - normalVelocityX - signal.velocityX) / VELOCITY_RESPONSE;
    const followAccelerationY = (desiredY - normalVelocityY - signal.velocityY) / VELOCITY_RESPONSE;
    // The original path already supplies its acceleration; integrate only its displacement.
    signal.velocityX += (normalForceX * (1 - signal.followWeight)
      + (followAccelerationX - normalAccelerationX) * signal.followWeight) * step;
    signal.velocityY += (normalForceY * (1 - signal.followWeight)
      + (followAccelerationY - normalAccelerationY) * signal.followWeight) * step;
    signal.shiftX += signal.velocityX * step;
    signal.shiftY += signal.velocityY * step;
  }
}
