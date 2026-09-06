import { describe, expect, it } from "vitest";

import {
  advancePointerMotion,
  advanceSignalMotion,
  clearPointerMotion,
  createPointerMotion,
  createSignalMotion,
  recordPointerMove,
  resetSignalMotion,
} from "./valuation-pointer-motion";

const STEP = 1 / 60;

function followingSignal() {
  const pointer = createPointerMotion();
  const signal = createSignalMotion(37);
  recordPointerMove(pointer, 100, 0, 0);
  advanceSignalMotion(signal, pointer, 100, 25, 0);
  for (let frame = 1; frame <= 90; frame += 1) {
    const time = frame * STEP;
    recordPointerMove(pointer, 100 + time * 120, 0, time);
    advancePointerMotion(pointer, STEP, time);
    advanceSignalMotion(signal, pointer, 100, 25, STEP);
  }
  return { pointer, signal, time: 90 * STEP };
}

function displacement(signal: ReturnType<typeof createSignalMotion>) {
  return Math.hypot(signal.shiftX, signal.shiftY);
}

function expectSameMotion(
  actual: ReturnType<typeof createSignalMotion>,
  expected: ReturnType<typeof createSignalMotion>,
) {
  expect(actual.shiftX).toBeCloseTo(expected.shiftX, 10);
  expect(actual.shiftY).toBeCloseTo(expected.shiftY, 10);
  expect(actual.velocityX).toBeCloseTo(expected.velocityX, 10);
  expect(actual.velocityY).toBeCloseTo(expected.velocityY, 10);
}

describe("valuation pointer motion", () => {
  it("leaves the changing normal path exactly intact without pointer movement", () => {
    const pointer = createPointerMotion();
    const signal = createSignalMotion(37);
    for (let frame = 0; frame <= 600; frame += 1) {
      const time = frame * STEP;
      advancePointerMotion(pointer, STEP, time);
      advanceSignalMotion(signal, pointer, 500 + Math.cos(time) * 280, 400 + Math.sin(time * 2) * 160, STEP);
      expect([signal.shiftX, signal.shiftY, signal.velocityX, signal.velocityY, signal.followWeight])
        .toEqual([0, 0, 0, 0, 0]);
    }
  });

  it("does not attract a particle under a stationary pointer or duplicate coordinate events", () => {
    const pointer = createPointerMotion();
    const signal = createSignalMotion(37);
    recordPointerMove(pointer, 100, 100, 0);
    const firstMoveTime = pointer.lastMoveTime;
    for (let frame = 1; frame <= 120; frame += 1) {
      const time = frame * STEP;
      recordPointerMove(pointer, 100, 100, time);
      advancePointerMotion(pointer, STEP, time);
      advanceSignalMotion(signal, pointer, 120, 110, STEP);
    }
    expect(pointer.lastMoveTime).toBe(firstMoveTime);
    expect(pointer.activity).toBe(0);
    expect(displacement(signal)).toBe(0);
    expect(signal.followWeight).toBe(0);
  });

  it("does not manufacture velocity when the pointer enters or reenters elsewhere", () => {
    const pointer = createPointerMotion();
    for (const [x, y, time] of [[1000, 900, 1], [-2000, 3000, 2]]) {
      recordPointerMove(pointer, x, y, time);
      advancePointerMotion(pointer, STEP, time);
      expect([pointer.x, pointer.y]).toEqual([x, y]);
      expect([pointer.velocityX, pointer.velocityY, pointer.activity]).toEqual([0, 0, 0]);
      clearPointerMotion(pointer);
    }
  });

  it("carries a nearby particle with lag while distant particles remain untouched", () => {
    const { pointer, signal } = followingSignal();
    expect(signal.shiftX).toBeGreaterThan(40);
    expect(signal.velocityX).toBeGreaterThan(10);
    expect(signal.followWeight).toBeGreaterThan(0.1);
    expect(100 + signal.shiftX).toBeLessThan(pointer.x);

    const distant = createSignalMotion(72);
    for (let frame = 0; frame < 60; frame += 1) {
      advanceSignalMotion(distant, pointer, 900, 600, STEP);
    }
    expect([distant.shiftX, distant.shiftY, distant.followWeight]).toEqual([0, 0, 0]);
  });

  it("follows slow pointer motion while sub-threshold drift stays inactive", () => {
    const simulate = (speed: number) => {
      const pointer = createPointerMotion();
      const signal = createSignalMotion(37);
      recordPointerMove(pointer, 100, 0, 0);
      advanceSignalMotion(signal, pointer, 100, 25, 0);
      for (let frame = 1; frame <= 120; frame += 1) {
        const time = frame * STEP;
        recordPointerMove(pointer, 100 + speed * time, 0, time);
        advancePointerMotion(pointer, STEP, time);
        advanceSignalMotion(signal, pointer, 100, 25, STEP);
      }
      return { pointer, signal };
    };
    const slow = simulate(40);
    expect(slow.pointer.activity).toBeGreaterThan(0);
    expect(slow.pointer.activity).toBeLessThan(1);
    expect(slow.signal.shiftX).toBeGreaterThan(8);
    for (const speed of [5, 9]) {
      const drift = simulate(speed);
      expect(drift.pointer.activity).toBe(0);
      expect([drift.signal.shiftX, drift.signal.shiftY, drift.signal.followWeight]).toEqual([0, 0, 0]);
    }
  });

  it("applies no cursor force outside the release radius, even while follow weight decays", () => {
    const { pointer, signal } = followingSignal();
    expect(signal.followWeight).toBeGreaterThan(0.1);
    const leftPointer = { ...pointer, x: -1000, y: 0 };
    const rightPointer = { ...pointer, x: 1000, y: 500 };
    const leftSignal = { ...signal };
    const rightSignal = { ...signal };
    advanceSignalMotion(leftSignal, leftPointer, 100, 25, STEP);
    advanceSignalMotion(rightSignal, rightPointer, 100, 25, STEP);
    expectSameMotion(leftSignal, rightSignal);
    expect(leftSignal.followWeight).toBeLessThan(signal.followWeight);
  });

  it("ignores settling and duplicate events after the actual pointer movement stops", () => {
    const { pointer, signal, time: stoppedAt } = followingSignal();
    const lastMovement = pointer.lastMoveTime;
    for (let frame = 1; frame <= 18; frame += 1) {
      const time = stoppedAt + frame * STEP;
      recordPointerMove(pointer, pointer.rawX, pointer.rawY, time);
      advancePointerMotion(pointer, STEP, time);
      advanceSignalMotion(signal, pointer, 100, 25, STEP);
    }
    expect(pointer.lastMoveTime).toBe(lastMovement);
    expect(pointer.activity).toBe(0);
  });

  it("returns to normal motion independently of the stopped pointer position", () => {
    const { pointer, signal, time: stoppedAt } = followingSignal();
    for (let frame = 1; frame <= 18; frame += 1) {
      advancePointerMotion(pointer, STEP, stoppedAt + frame * STEP);
      advanceSignalMotion(signal, pointer, 100, 25, STEP);
    }
    expect(pointer.activity).toBe(0);
    const stoppedDisplacement = displacement(signal);
    const firstSignal = { ...signal };
    const secondSignal = { ...signal };
    const secondPointer = { ...pointer, x: 100, y: 25, rawX: 100, rawY: 25 };
    for (let frame = 1; frame <= 240; frame += 1) {
      const time = stoppedAt + 0.3 + frame * STEP;
      advancePointerMotion(pointer, STEP, time);
      advancePointerMotion(secondPointer, STEP, time);
      advanceSignalMotion(firstSignal, pointer, 100, 25, STEP);
      advanceSignalMotion(secondSignal, secondPointer, 100, 25, STEP);
      expectSameMotion(firstSignal, secondSignal);
    }
    expect(displacement(firstSignal)).toBeLessThan(stoppedDisplacement);
    expect(displacement(firstSignal)).toBeLessThan(0.1);
    expect(firstSignal.followWeight).toBeLessThan(0.001);
  });

  it("keeps comparable trajectories at 30, 60, and 120 frames per second", () => {
    const simulate = (rate: number) => {
      const pointer = createPointerMotion();
      const signal = createSignalMotion(37);
      recordPointerMove(pointer, 100, 70, 0);
      advanceSignalMotion(signal, pointer, 100, 104, 0);
      for (let frame = 1; frame <= rate * 2; frame += 1) {
        const time = frame / rate;
        recordPointerMove(pointer, 100 + 100 * time, 70 + Math.sin(time * 2) * 20, time);
        advancePointerMotion(pointer, 1 / rate, time);
        advanceSignalMotion(signal, pointer, 100 + Math.sin(time * 0.7) * 6, 100 + Math.cos(time * 0.5) * 4, 1 / rate);
        expect([signal.shiftX, signal.shiftY, signal.velocityX, signal.velocityY].every(Number.isFinite)).toBe(true);
      }
      return signal;
    };
    const reference = simulate(120);
    for (const rate of [30, 60]) {
      const signal = simulate(rate);
      expect(Math.hypot(signal.shiftX - reference.shiftX, signal.shiftY - reference.shiftY)).toBeLessThan(6);
      expect(Math.hypot(signal.velocityX - reference.velocityX, signal.velocityY - reference.velocityY)).toBeLessThan(20);
    }
  });

  it("clamps a stalled frame instead of integrating the entire elapsed interval", () => {
    const { pointer, signal, time } = followingSignal();
    const boundedPointer = { ...pointer };
    const boundedSignal = { ...signal };
    for (const cursor of [pointer, boundedPointer]) {
      recordPointerMove(cursor, cursor.rawX + 80, cursor.rawY + 20, time + 0.1);
    }
    advancePointerMotion(pointer, 10, time + 0.1);
    advancePointerMotion(boundedPointer, 1 / 30, time + 0.1);
    advanceSignalMotion(signal, pointer, 100, 25, 10);
    advanceSignalMotion(boundedSignal, boundedPointer, 100, 25, 1 / 30);
    expect([pointer.x, pointer.y, pointer.velocityX, pointer.velocityY, pointer.activity])
      .toEqual([boundedPointer.x, boundedPointer.y, boundedPointer.velocityX, boundedPointer.velocityY, boundedPointer.activity]);
    expectSameMotion(signal, boundedSignal);
  });

  it("preserves inertia through a reversal and clears only interaction state on reset", () => {
    const { pointer, signal, time } = followingSignal();
    const previousVelocity = signal.velocityX;
    expect(previousVelocity).toBeGreaterThan(0);
    recordPointerMove(pointer, pointer.rawX - 15, pointer.rawY, time + STEP);
    advancePointerMotion(pointer, STEP, time + STEP);
    advanceSignalMotion(signal, pointer, 100, 25, STEP);
    expect(signal.velocityX).toBeGreaterThan(0);
    const offsets = [signal.trailOffset, signal.sideOffset, signal.strength];
    resetSignalMotion(signal);
    expect([signal.shiftX, signal.shiftY, signal.velocityX, signal.velocityY, signal.followWeight])
      .toEqual([0, 0, 0, 0, 0]);
    expect([signal.trailOffset, signal.sideOffset, signal.strength]).toEqual(offsets);
  });
});
