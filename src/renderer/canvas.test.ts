import { describe, expect, it } from 'vitest';
import { computeCanvasMetrics, computeFoodPulseFactor, computeFoodPulseMetrics } from './canvas';

/**
 * Pure sizing/DPR math only (AC5). AC16 forbids asserting on canvas
 * output, pixel data or draw-call snapshots, so drawing itself
 * (`render`) is verified by eyeballing `npm run dev`, not here.
 */
describe('computeCanvasMetrics', () => {
  it('fits a square grid into a square viewport at devicePixelRatio 1', () => {
    const metrics = computeCanvasMetrics(28, 28, 560, 560, 1);
    expect(metrics.cellSize).toBe(20);
    expect(metrics.cssWidth).toBe(560);
    expect(metrics.cssHeight).toBe(560);
    expect(metrics.pixelWidth).toBe(560);
    expect(metrics.pixelHeight).toBe(560);
  });

  it('keeps the aspect ratio by using the smaller of the two available dimensions', () => {
    const metrics = computeCanvasMetrics(28, 28, 1000, 400, 1);
    // Height is the binding constraint: 400 / 28 = 14.28 -> floor 14.
    expect(metrics.cellSize).toBe(14);
    expect(metrics.cssWidth).toBe(metrics.cssHeight);
  });

  it('scales the backing store by devicePixelRatio so edges stay crisp', () => {
    const metrics = computeCanvasMetrics(28, 28, 560, 560, 2);
    expect(metrics.cssWidth).toBe(560);
    expect(metrics.pixelWidth).toBe(1120);
    expect(metrics.pixelHeight).toBe(1120);
  });

  it('never produces a cell size below 1 even for a tiny viewport', () => {
    const metrics = computeCanvasMetrics(28, 28, 10, 10, 1);
    expect(metrics.cellSize).toBe(1);
  });

  it('falls back to devicePixelRatio 1 for a non-positive value', () => {
    const metrics = computeCanvasMetrics(28, 28, 560, 560, 0);
    expect(metrics.pixelWidth).toBe(metrics.cssWidth);
  });
});

/**
 * Pure pulse math for the food's pulsing animation (issue #16). No DOM,
 * no clock: `timestampMs` is a plain parameter (ADR-0006 — the tick loop
 * is the one place wall-clock time enters the program), so this is
 * testable the same way `accumulate` is tested in
 * `src/composition/loop.test.ts`.
 */
describe('computeFoodPulseFactor', () => {
  it('stays within [0, 1] at t = 0', () => {
    const factor = computeFoodPulseFactor(0);
    expect(factor).toBeGreaterThanOrEqual(0);
    expect(factor).toBeLessThanOrEqual(1);
  });

  it('never goes negative for a very large timestamp', () => {
    const factor = computeFoodPulseFactor(Number.MAX_SAFE_INTEGER);
    expect(factor).toBeGreaterThanOrEqual(0);
    expect(factor).toBeLessThanOrEqual(1);
  });

  it('never goes negative for a very large negative timestamp', () => {
    const factor = computeFoodPulseFactor(-Number.MAX_SAFE_INTEGER);
    expect(factor).toBeGreaterThanOrEqual(0);
    expect(factor).toBeLessThanOrEqual(1);
  });

  it('never goes negative for an ordinary negative timestamp', () => {
    const factor = computeFoodPulseFactor(-500);
    expect(factor).toBeGreaterThanOrEqual(0);
    expect(factor).toBeLessThanOrEqual(1);
  });

  it('falls back to a safe value for non-finite input (NaN, Infinity)', () => {
    expect(computeFoodPulseFactor(Number.NaN)).toBeGreaterThanOrEqual(0);
    expect(computeFoodPulseFactor(Number.POSITIVE_INFINITY)).toBeGreaterThanOrEqual(0);
    expect(computeFoodPulseFactor(Number.NEGATIVE_INFINITY)).toBeGreaterThanOrEqual(0);
  });

  it('is periodic: the same point in successive cycles yields the same factor', () => {
    const first = computeFoodPulseFactor(200);
    const second = computeFoodPulseFactor(200 + 1400 * 3);
    expect(second).toBeCloseTo(first, 10);
  });
});

describe('computeFoodPulseMetrics', () => {
  it('never returns a negative size, offset or glow blur for a huge timestamp', () => {
    const metrics = computeFoodPulseMetrics(Number.MAX_SAFE_INTEGER, 20);
    expect(metrics.size).toBeGreaterThanOrEqual(0);
    expect(metrics.offset).toBeGreaterThanOrEqual(0);
    expect(metrics.glowBlur).toBeGreaterThanOrEqual(0);
  });

  it('never returns a negative size, offset or glow blur for a huge negative timestamp', () => {
    const metrics = computeFoodPulseMetrics(-Number.MAX_SAFE_INTEGER, 20);
    expect(metrics.size).toBeGreaterThanOrEqual(0);
    expect(metrics.offset).toBeGreaterThanOrEqual(0);
    expect(metrics.glowBlur).toBeGreaterThanOrEqual(0);
  });

  it('never returns a negative size, offset or glow blur for a zero or negative cell size', () => {
    const zero = computeFoodPulseMetrics(500, 0);
    expect(zero.size).toBeGreaterThanOrEqual(0);
    expect(zero.offset).toBeGreaterThanOrEqual(0);
    expect(zero.glowBlur).toBeGreaterThanOrEqual(0);

    const negative = computeFoodPulseMetrics(500, -20);
    expect(negative.size).toBeGreaterThanOrEqual(0);
    expect(negative.offset).toBeGreaterThanOrEqual(0);
    expect(negative.glowBlur).toBeGreaterThanOrEqual(0);
  });

  it('keeps the drawn food within its cell: size + 2*offset never exceeds cellSize', () => {
    const cellSize = 20;
    for (const timestampMs of [0, 350, 700, 1050, 1400, -1000, 987_654_321]) {
      const metrics = computeFoodPulseMetrics(timestampMs, cellSize);
      expect(metrics.size + metrics.offset * 2).toBeLessThanOrEqual(cellSize + 1e-9);
    }
  });
});
