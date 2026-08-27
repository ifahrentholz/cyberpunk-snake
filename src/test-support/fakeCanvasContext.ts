/**
 * Shared fake `CanvasRenderingContext2D` test double (issue #16 Stage 6
 * review). Used by both `src/main.test.ts` (composition-level wiring
 * tests) and `src/renderer/canvas.render.test.ts` (the renderer's own
 * smoke test) — previously duplicated as a private function inside
 * `main.test.ts`.
 *
 * jsdom has no 2D canvas backend without the native `canvas` npm package
 * (not a dependency here — a DOM capability gap, not something to
 * draw-test around). This stub gives `render()`'s calls somewhere
 * harmless to land instead of installing that package.
 *
 * Only implements what `src/renderer/canvas.ts` actually calls as a
 * *method* on `ctx`: `fillRect`, `fillText`, `setTransform` (used by
 * `resizeCanvas`) and `createRadialGradient` (not used by `render`
 * today, stubbed anyway so a future rendering decision that reaches for
 * it is not pre-decided by a gap in test infrastructure rather than a
 * real constraint — see #16 Stage 6 review). Property assignments like
 * `fillStyle`/`shadowBlur`/`textAlign` need no stub: a plain object
 * accepts arbitrary property writes without them being declared first.
 *
 * Per AC16 ("no test touches canvas output, pixel data, or draw-call
 * snapshots"), nothing built on this fake should assert on what was
 * drawn or how these stubs were called — only that code exercising them
 * runs without throwing.
 */
import { vi } from 'vitest';

export function createFakeCanvasContext(): CanvasRenderingContext2D {
  return {
    fillRect: vi.fn(),
    fillText: vi.fn(),
    setTransform: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    fillStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
  } as unknown as CanvasRenderingContext2D;
}
