import { describe, expect, it } from "vitest";

import {
  advancePointerMotion,
  advanceSignalMotion,
  clearPointerMotion,
  createPointerMotion,
  createSignalMotion,
  recordPointerMove,
  resetSignalMotion,
  type SignalMotion,
} from "./valuation-pointer-motion";

const STEP = 1 / 60;

type Dot = { motion: SignalMotion; x: number; y: number };

function createScene(positions: readonly (readonly [number, number])[], x = -60, y = 0) {
  const pointer = createPointerMotion();
  const dots: Dot[] = positions.map(([normalX, normalY], index) => ({
    motion: createSignalMotion(index), x: normalX, y: normalY,
  }));
  const motions = dots.map((dot) => dot.motion);
  recordPointerMove(pointer, x, y, 0);
  for (const dot of dots) advanceSignalMotion(dot.motion, pointer, dot.x, dot.y, 0);
  const tick = (time: number, nextX?: number, nextY?: number, delta = STEP) => {
    if (nextX !== undefined && nextY !== undefined) recordPointerMove(pointer, nextX, nextY, time);
    advancePointerMotion(pointer, delta, time, motions);
    for (const dot of dots) advanceSignalMotion(dot.motion, pointer, dot.x, dot.y, delta);
  };
  return { pointer, dots, motions, tick };
}

function expectUntouched(signal: SignalMotion) {
  expect([signal.shiftX, signal.shiftY, signal.velocityX, signal.velocityY, signal.followWeight])
    .toEqual([0, 0, 0, 0, 0]);
  expect(signal.captured).toBe(false);
}

function displacement(signal: SignalMotion) {
  return Math.hypot(signal.shiftX, signal.shiftY);
}

describe("valuation cursor wake", () => {
  it("leaves an evolving normal path exactly intact without pointer movement", () => {
    const pointer = createPointerMotion();
    const signal = createSignalMotion(37);
    for (let frame = 0; frame <= 600; frame += 1) {
      const time = frame * STEP;
      advancePointerMotion(pointer, STEP, time, [signal]);
      advanceSignalMotion(signal, pointer, 500 + Math.cos(time) * 280, 400 + Math.sin(time * 2) * 160, STEP);
      expectUntouched(signal);
    }
  });

  it("keeps every dot in a horizontal row exactly untouched until the pointer passes it", () => {
    const scene = createScene(Array.from({ length: 12 }, (_, index) => [index * 50, 0] as const));
    const captured = new Set<SignalMotion>();
    let followersBehind = 0;
    for (let frame = 1; frame <= 330; frame += 1) {
      const time = frame * STEP;
      const cursorX = -60 + time * 100;
      scene.tick(time, cursorX, 0);
      for (const dot of scene.dots) {
        if (dot.x > cursorX) expectUntouched(dot.motion);
        if (dot.motion.captured) {
          captured.add(dot.motion);
          if (dot.motion.shiftX > 1 && dot.x + dot.motion.shiftX < cursorX) followersBehind += 1;
        }
      }
    }
    expect(captured.size).toBeGreaterThanOrEqual(6);
    expect(followersBehind).toBeGreaterThan(10);
  });

  it("captures a crossed narrow lane while leaving adjacent untraversed dots alone", () => {
    const scene = createScene([[100, 20], [100, 90], [100, -90]]);
    let closeCaptured = false;
    for (let frame = 1; frame <= 180; frame += 1) {
      scene.tick(frame * STEP, -60 + frame * STEP * 120, 0);
      closeCaptured ||= scene.dots[0].motion.captured;
      expectUntouched(scene.dots[1].motion);
      expectUntouched(scene.dots[2].motion);
    }
    expect(closeCaptured).toBe(true);
  });

  it("bounds the combined following and releasing population during repeated passes", () => {
    const positions = Array.from({ length: 120 }, (_, index) => [100 + Math.floor(index / 40) * 55, (index % 40) - 20] as const);
    const scene = createScene(positions);
    let peak = 0;
    let sawRelease = false;
    for (let frame = 1; frame <= 300; frame += 1) {
      const time = frame * STEP;
      scene.tick(time, -60 + time * 180, 0);
      const active = scene.motions.filter((signal) => signal.captured || signal.followWeight > 0).length;
      peak = Math.max(peak, active);
      sawRelease ||= scene.motions.some((signal) => !signal.captured && signal.followWeight > 0);
      expect(active).toBeLessThanOrEqual(36);
    }
    expect(peak).toBeGreaterThan(0);
    expect(sawRelease).toBe(true);
  });

  it("does not capture under a stationary pointer or through duplicate coordinate events", () => {
    const scene = createScene([[110, 10]], 100, 0);
    const initialLastMove = scene.pointer.lastMoveTime;
    for (let frame = 1; frame <= 120; frame += 1) {
      scene.tick(frame * STEP, 100, 0);
      expectUntouched(scene.dots[0].motion);
    }
    expect(scene.pointer.lastMoveTime).toBe(initialLastMove);
    expect(scene.pointer.captureAllowed).toBe(false);
  });

  it("does not bridge the field when the cursor leaves and reenters elsewhere", () => {
    const scene = createScene([[200, 0], [500, 0], [800, 0]], 0, 0);
    for (let frame = 1; frame <= 15; frame += 1) scene.tick(frame * STEP, frame, 0);
    clearPointerMotion(scene.pointer);
    recordPointerMove(scene.pointer, 1000, 0, 1);
    scene.tick(1);
    for (const signal of scene.motions) expectUntouched(signal);
    for (let frame = 1; frame <= 30; frame += 1) scene.tick(1 + frame * STEP, 1000 + frame, 0);
    for (const signal of scene.motions) expectUntouched(signal);
  });

  it("keeps follower movement restrained while fast movement outruns the wake", () => {
    const run = (speed: number) => {
      const scene = createScene([[0, 0]], -25, 0);
      let peakSpeed = 0;
      let maximumLag = 0;
      let wasCaptured = false;
      let maximumShift = 0;
      for (let frame = 1; frame <= 120; frame += 1) {
        const time = frame * STEP;
        scene.tick(time, -25 + speed * time, 0);
        const signal = scene.dots[0].motion;
        if (signal.captured) {
          wasCaptured = true;
          peakSpeed = Math.max(peakSpeed, Math.hypot(signal.velocityX, signal.velocityY));
          maximumLag = Math.max(maximumLag, scene.pointer.rawX - signal.shiftX);
          maximumShift = Math.max(maximumShift, signal.shiftX);
          expect(Math.hypot(signal.velocityX, signal.velocityY)).toBeLessThanOrEqual(181);
        }
      }
      return { peakSpeed, maximumLag, maximumShift, wasCaptured };
    };
    const slow = run(100);
    const fast = run(1200);
    expect(slow.wasCaptured).toBe(true);
    expect(fast.wasCaptured).toBe(true);
    expect(slow.maximumShift).toBeGreaterThan(2);
    expect(fast.maximumLag).toBeGreaterThan(slow.maximumLag);
    expect(fast.peakSpeed).toBeLessThanOrEqual(181);
  });

  it("visits a turn in order before advancing along its outgoing trail segment", () => {
    const scene = createScene([[20, 0]], 0, 0);
    const signal = scene.motions[0];
    signal.sideOffset = 0;
    signal.followDelay = 0.07;
    signal.responseTime = 0.2;
    signal.maxSpeed = 140;
    signal.lifetime = 0.65;
    let visitedCorner = false;
    let followedOutgoingSegment = false;
    let previousTrailTime = -Infinity;
    for (let frame = 1; frame <= 72; frame += 1) {
      const time = frame * STEP;
      scene.tick(time, Math.min(30, time * 100), Math.max(0, time * 100 - 30));
      if (!signal.captured) continue;
      expect(signal.trailTime).toBeGreaterThanOrEqual(previousTrailTime);
      previousTrailTime = signal.trailTime;
      visitedCorner ||= Math.hypot(signal.pathX - 30, signal.pathY) < 6;
      if (signal.pathY > 6) {
        expect(visitedCorner).toBe(true);
        expect(signal.pathX).toBeGreaterThan(26);
        followedOutgoingSegment = true;
      }
    }
    expect(visitedCorner).toBe(true);
    expect(followedOutgoingSegment).toBe(true);
  });

  it("does not create new followers after actual movement stops", () => {
    const scene = createScene([[0, 0], [80, 0], [35, 30]], -30, 0);
    for (let frame = 1; frame <= 30; frame += 1) scene.tick(frame * STEP, -30 + frame * 2, 0);
    const capturedBeforeStop = new Set(scene.motions.filter((signal) => signal.captured));
    expect(capturedBeforeStop.size).toBeGreaterThan(0);
    const lastMove = scene.pointer.lastMoveTime;
    for (let frame = 1; frame <= 90; frame += 1) {
      scene.tick(0.5 + frame * STEP, 30, 0);
      for (const signal of scene.motions) {
        if (!capturedBeforeStop.has(signal)) expectUntouched(signal);
      }
    }
    expect(scene.pointer.lastMoveTime).toBe(lastMove);
    expect(scene.motions.every((signal) => !signal.captured)).toBe(true);
  });

  it("does not pick up a normally moving dot that enters old trail geometry after the cursor stops", () => {
    const scene = createScene([[15, 90]], -30, 0);
    for (let frame = 1; frame <= 30; frame += 1) scene.tick(frame * STEP, -30 + frame * 2, 0);
    expectUntouched(scene.motions[0]);
    scene.dots[0].y = 15;
    for (let frame = 1; frame <= 30; frame += 1) {
      scene.tick(0.5 + frame * STEP);
      expectUntouched(scene.motions[0]);
    }
  });

  it("releases expired followers even while the cursor continues moving and returns them to normal", () => {
    const scene = createScene([[0, 0]], -20, 0);
    let capturedAt: number | undefined;
    let releasedAt: number | undefined;
    let releaseShift = 0;
    let sawPartialRelease = false;
    for (let frame = 1; frame <= 240; frame += 1) {
      const time = frame * STEP;
      scene.tick(time, -20 + time * 90, 0);
      const signal = scene.motions[0];
      if (signal.captured && capturedAt === undefined) capturedAt = time;
      if (capturedAt !== undefined && !signal.captured && releasedAt === undefined) {
        releasedAt = time;
        releaseShift = displacement(signal);
      }
      sawPartialRelease ||= signal.releaseProgress > 0 && signal.releaseProgress < 1;
    }
    expect(capturedAt).toBeDefined();
    expect(releasedAt).toBeDefined();
    expect(releasedAt! - capturedAt!).toBeLessThanOrEqual(0.75);
    expect(releaseShift).toBeGreaterThan(0);
    expect(sawPartialRelease).toBe(true);
    expect(displacement(scene.motions[0])).toBeLessThan(0.05);
    expect(scene.motions[0].followWeight).toBe(0);
  });

  it("keeps comparable trajectories at 30, 60, and 120 frames per second", () => {
    const run = (rate: number) => {
      const scene = createScene([[0, 15]], -20, 0);
      const samples: number[][] = [];
      for (let frame = 1; frame <= rate; frame += 1) {
        const time = frame / rate;
        scene.dots[0].x = Math.sin(time * 0.7) * 4;
        scene.dots[0].y = 15 + Math.sin(time * 0.5) * 3;
        scene.tick(time, -20 + time * 110, Math.sin(time * 2) * 5, 1 / rate);
        const signal = scene.motions[0];
        expect([signal.shiftX, signal.shiftY, signal.velocityX, signal.velocityY].every(Number.isFinite)).toBe(true);
        if (frame % (rate / 10) === 0) samples.push([signal.shiftX, signal.shiftY]);
      }
      return samples;
    };
    const reference = run(120);
    for (const rate of [30, 60]) {
      run(rate).forEach((sample, index) => {
        expect(Math.hypot(sample[0] - reference[index][0], sample[1] - reference[index][1])).toBeLessThan(8);
      });
    }
  });

  it("resets interaction state while retaining authored per-particle variation", () => {
    const scene = createScene([[0, 0]], -20, 0);
    const signal = scene.motions[0];
    const variation = [signal.followDelay, signal.responseTime, signal.maxSpeed, signal.lifetime, signal.sideOffset, signal.strength];
    for (let frame = 1; frame <= 30; frame += 1) scene.tick(frame * STEP, -20 + frame * 2, 0);
    expect(displacement(signal)).toBeGreaterThan(0);
    resetSignalMotion(signal);
    expectUntouched(signal);
    expect([signal.followDelay, signal.responseTime, signal.maxSpeed, signal.lifetime, signal.sideOffset, signal.strength])
      .toEqual(variation);
  });
});
