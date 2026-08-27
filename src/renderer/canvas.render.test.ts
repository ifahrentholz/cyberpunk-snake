import { describe, expect, it } from 'vitest';
import { createGame, step, type GameState } from '../logic/game';
import { createFakeCanvasContext } from '../test-support/fakeCanvasContext';
import { render } from './canvas';

/**
 * Smoke test for `render` (issue #16 Stage 6 review). Before this file,
 * `render` was invoked exactly once across the whole 143-test suite —
 * the one `src/main.test.ts` case that makes its fake `fillRect` throw
 * immediately, inside `drawBackground`, before `drawGrid`, `drawFood`,
 * `drawSnake`, `drawHud`, `drawOverlay` or `drawScanlines` ever ran.
 * Pinned by the reviewer: hard-code `drawGrid` to `throw` and the whole
 * suite stayed green. So a typo in a `COLORS` key, an off-by-one loop
 * bound, or a negative `fillRect` argument in any of those functions had
 * no test that would ever reach it.
 *
 * This closes that gap without breaching AC16 ("no test touches canvas
 * output, pixel data, or draw-call snapshots"): every test below asserts
 * only `not.toThrow()` — nothing about what was drawn, no call counts, no
 * argument assertions, no snapshots. That is enough to catch the failure
 * classes above; it is deliberately not enough to catch a wrong colour or
 * a misplaced shape, which is the point — the eyeball check via
 * `npm run dev` still owns that.
 *
 * No DOM needed: `ctx` is the shared fake object (a plain object, not a
 * real canvas), and `GameState` is plain data from `../logic/game` — so,
 * like `canvas.test.ts`, this runs under the default `node` environment.
 */
function buildStates(): Record<GameState['status'], GameState> {
  const rng = (): number => 0.5;

  const ready = createGame({ gridWidth: 10, gridHeight: 10 }, rng);
  const running = step(ready, { type: 'tick', rng });
  const paused = step(running, { type: 'pause' });

  // A 3x3 grid with a single-segment snake (no self-collision possible)
  // starting at the centre, moving right, reaches the wall — and so
  // 'over' — within two ticks.
  const smallReady = createGame({ gridWidth: 3, gridHeight: 3, initialSnakeLength: 1 }, rng);
  const smallRunning = step(smallReady, { type: 'tick', rng });
  const over = step(smallRunning, { type: 'tick', rng });
  if (over.status !== 'over') {
    // Fail loudly rather than silently testing the wrong status if this
    // setup assumption ever stops holding (e.g. a future logic change).
    throw new Error(
      `test setup assumption broken: expected the 3x3 grid to reach "over" within two ticks, got "${over.status}"`,
    );
  }

  return { ready, running, paused, over };
}

describe('render (smoke test)', () => {
  const states = buildStates();
  const timestamps = [0, 700, -500];

  for (const status of ['ready', 'running', 'paused', 'over'] as const) {
    for (const timestampMs of timestamps) {
      it(`does not throw for status "${status}" at timestamp ${timestampMs}`, () => {
        const ctx = createFakeCanvasContext();
        const state = states[status];
        expect(() => render(ctx, state, 20, timestampMs)).not.toThrow();
      });
    }
  }
});
