import { describe, expect, it } from 'vitest';
import { computeCanvasMetrics, computeFoodPulseFactor, computeFoodPulseMetrics, FOOD_PULSE_MAX_INSET_RATIO } from './canvas';

/**
 * Pure sizing/DPR math only (AC5). AC16 forbids asserting on canvas
 * output, pixel data or draw-call snapshots; `render` itself is covered
 * by a smoke test in `canvas.render.test.ts` (asserts only that it does
 * not throw) and, for what it actually looks like, by eyeballing
 * `npm run dev`.
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
 *
 * HONESTY NOTE, added in Stage 6 review of #16 (ADR-0004: a test that
 * stays green when the rule it names is deleted is worse than no test):
 * the ten tests through the end of `computeFoodPulseMetrics` below
 * document the functions' OUTPUT RANGE across extreme inputs — real
 * regression coverage for "the pulse factor is always a valid [0, 1]
 * blend weight" and "the drawn size, its offset and its glow blur are
 * never negative". They are NOT proof that `computeFoodPulseFactor`'s
 * `Math.max(0, …)`/`Math.min(1, …)` or `computeFoodPulseMetrics`'s three
 * `Math.max(0, …)` calls do anything at today's constants: delete all
 * four and every test in both blocks still passes, because `Math.sin`
 * is already mathematically bounded to [-1, 1] for any finite input, and
 * `FOOD_PULSE_MAX_INSET_RATIO` — pinned in its own describe block right
 * below — stays under the 0.5 threshold past which an unclamped inset
 * would reach (and then exceed) `cellSize`.
 *
 * Two of the ten are the exception, called out individually below: the
 * non-finite-input case (a real `Number.isFinite` fallback branch —
 * `Math.max`/`Math.min` pass a `NaN` straight through, so it does NOT
 * come from the clamps) and the zero/negative-`cellSize` case (a real
 * `cellSize > 0` fallback branch).
 *
 * The `Math.max`/`Math.min` clamps themselves stay in the source as
 * documented forward defense (see the comment on `computeFoodPulseMetrics`
 * in `canvas.ts`) against the same failure class that made an unclamped,
 * animation-derived radius crash `createRadialGradient` with
 * `IndexSizeError` before #6. If `FOOD_PULSE_MAX_INSET_RATIO` ever moved
 * past 0.5, or the wave function ever stopped being innately bounded,
 * these same describe blocks — checking actual output, not a code path
 * — are what would catch it and turn red.
 */
describe('FOOD_PULSE_MAX_INSET_RATIO', () => {
  it('stays below 0.5, the point past which an unclamped pulse would draw a negative-sized food', () => {
    // At the pulse's peak (factor === 1), inset reaches
    // cellSize * FOOD_PULSE_MAX_INSET_RATIO. size is cellSize - inset*2,
    // so at ratio 0.5, inset*2 reaches cellSize and size hits exactly
    // zero; any higher and it goes negative without a clamp. This is the
    // condition computeFoodPulseMetrics's clamps actually guard against
    // — so, unlike the value-range tests above, this constant (not the
    // clamps' code path) is what gets pinned directly.
    expect(FOOD_PULSE_MAX_INSET_RATIO).toBeLessThan(0.5);
  });
});

describe('computeFoodPulseFactor', () => {
  it('stays within [0, 1] at t = 0', () => {
    const factor = computeFoodPulseFactor(0);
    expect(factor).toBeGreaterThanOrEqual(0);
    expect(factor).toBeLessThanOrEqual(1);
  });

  it('stays within [0, 1] for a very large timestamp (Math.sin’s own bound guarantees this, not the explicit clamp — see note above)', () => {
    const factor = computeFoodPulseFactor(Number.MAX_SAFE_INTEGER);
    expect(factor).toBeGreaterThanOrEqual(0);
    expect(factor).toBeLessThanOrEqual(1);
  });

  it('stays within [0, 1] for a very large negative timestamp (same reason as above)', () => {
    const factor = computeFoodPulseFactor(-Number.MAX_SAFE_INTEGER);
    expect(factor).toBeGreaterThanOrEqual(0);
    expect(factor).toBeLessThanOrEqual(1);
  });

  it('stays within [0, 1] for an ordinary negative timestamp', () => {
    const factor = computeFoodPulseFactor(-500);
    expect(factor).toBeGreaterThanOrEqual(0);
    expect(factor).toBeLessThanOrEqual(1);
  });

  it('stays within [0, 1] for non-finite input (NaN, Infinity) — this DOES exercise a real branch: the Number.isFinite fallback to 0, since Math.max/min would otherwise pass a NaN straight through', () => {
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
  it('keeps size/offset/glowBlur within their non-negative range for a huge timestamp (value-range check — see note above)', () => {
    const metrics = computeFoodPulseMetrics(Number.MAX_SAFE_INTEGER, 20);
    expect(metrics.size).toBeGreaterThanOrEqual(0);
    expect(metrics.offset).toBeGreaterThanOrEqual(0);
    expect(metrics.glowBlur).toBeGreaterThanOrEqual(0);
  });

  it('keeps size/offset/glowBlur within their non-negative range for a huge negative timestamp (same reason as above)', () => {
    const metrics = computeFoodPulseMetrics(-Number.MAX_SAFE_INTEGER, 20);
    expect(metrics.size).toBeGreaterThanOrEqual(0);
    expect(metrics.offset).toBeGreaterThanOrEqual(0);
    expect(metrics.glowBlur).toBeGreaterThanOrEqual(0);
  });

  it('collapses size/offset to zero for a zero or negative cell size — this DOES exercise a real branch: the cellSize > 0 fallback, not the four clamps under review above', () => {
    const zero = computeFoodPulseMetrics(500, 0);
    expect(zero.size).toBeGreaterThanOrEqual(0);
    expect(zero.offset).toBeGreaterThanOrEqual(0);
    expect(zero.glowBlur).toBeGreaterThanOrEqual(0);

    const negative = computeFoodPulseMetrics(500, -20);
    expect(negative.size).toBeGreaterThanOrEqual(0);
    expect(negative.offset).toBeGreaterThanOrEqual(0);
    expect(negative.glowBlur).toBeGreaterThanOrEqual(0);
  });

  it('never lets the drawn food overflow its cell: 0 <= size <= cellSize and offset >= 0', () => {
    // NOTE (Stage 6 review of #16, found while empirically re-running the
    // clamp-removal probe): the previous version of this test asserted
    // `size + 2*offset <= cellSize`, which is an algebraic tautology given
    // `offset` is DEFINED as `(cellSize - size) / 2` — that sum reduces to
    // `cellSize` exactly by substitution, for any `size` whatsoever,
    // clamped or not, negative or not. It could never fail. Asserting on
    // `size` and `offset` independently (as below) is the version that
    // actually encodes "the food stays within its cell": confirmed by
    // temporarily setting FOOD_PULSE_MAX_INSET_RATIO to 0.6 and removing
    // the four clamps together — size goes to -4 at t = 350 (peak pulse,
    // cellSize 20), and this version of the test catches it; the old
    // summed version did not.
    const cellSize = 20;
    for (const timestampMs of [0, 350, 700, 1050, 1400, -1000, 987_654_321]) {
      const metrics = computeFoodPulseMetrics(timestampMs, cellSize);
      expect(metrics.size).toBeGreaterThanOrEqual(0);
      expect(metrics.size).toBeLessThanOrEqual(cellSize);
      expect(metrics.offset).toBeGreaterThanOrEqual(0);
    }
  });
});
