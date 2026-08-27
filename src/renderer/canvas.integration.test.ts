// @vitest-environment jsdom
/**
 * Stage 6 review of PR #17: `computeCanvasMetrics` has clean pure tests
 * including `devicePixelRatio = 2` (see `canvas.test.ts`), but the DOM
 * wrapper that actually applies that math — `resizeCanvas`, which sets
 * `canvas.width`/`style.width` and the context's DPR transform — was
 * only ever exercised (via `src/main.test.ts`) under jsdom's default
 * `devicePixelRatio` of 1, where CSS size and backing-store size are
 * numerically identical and a square grid makes `width === height`
 * trivially true regardless of DPR handling. This is the ONE test in
 * this codebase that exercises `resizeCanvas` itself with `dpr !== 1`,
 * mirroring the `keyboard.integration.test.ts` convention: a pure-math
 * suite plus one focused DOM integration test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resizeCanvas } from './canvas';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resizeCanvas (integration)', () => {
  it('scales the backing store by devicePixelRatio while the CSS size stays in logical pixels', () => {
    const canvas = document.createElement('canvas');
    const setTransform = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      setTransform,
    } as unknown as CanvasRenderingContext2D);

    const view = { innerWidth: 1000, innerHeight: 1000, devicePixelRatio: 2 } as unknown as Window;

    const cellSize = resizeCanvas(canvas, 28, 28, view);

    expect(cellSize).toBeGreaterThan(0);
    const cssWidth = Number.parseInt(canvas.style.width, 10);
    const cssHeight = Number.parseInt(canvas.style.height, 10);
    expect(cssWidth).toBeGreaterThan(0);

    // The point of this test: the attribute (backing-store) size and the
    // CSS (layout) size must actually diverge when devicePixelRatio !== 1
    // — proving DPR handling is exercised through the real DOM wrapper,
    // not just asserted in isolation against plain numbers.
    expect(canvas.width).toBe(cssWidth * 2);
    expect(canvas.height).toBe(cssHeight * 2);
    expect(canvas.width).not.toBe(cssWidth);
    expect(canvas.style.width).toBe(`${cssWidth}px`);

    expect(setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
  });

  it('falls back to an identity-scale transform when devicePixelRatio is 1 (the jsdom default main.test.ts otherwise always runs under)', () => {
    const canvas = document.createElement('canvas');
    const setTransform = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      setTransform,
    } as unknown as CanvasRenderingContext2D);

    const view = { innerWidth: 1000, innerHeight: 1000, devicePixelRatio: 1 } as unknown as Window;

    resizeCanvas(canvas, 28, 28, view);

    const cssWidth = Number.parseInt(canvas.style.width, 10);
    expect(canvas.width).toBe(cssWidth);
    expect(setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
  });
});
