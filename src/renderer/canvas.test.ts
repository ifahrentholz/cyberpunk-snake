import { describe, expect, it } from 'vitest';
import { computeCanvasMetrics } from './canvas';

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
