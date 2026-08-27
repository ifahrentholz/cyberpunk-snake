import { describe, expect, it } from 'vitest';
import { createGame, step, type GameState, type Position } from '../logic/game';
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
 * `npm run dev` still owns that. If any of these tests could go red from
 * a future colour change, it was built wrong.
 *
 * No DOM needed: `ctx` is the shared fake object (a plain object, not a
 * real canvas), and `GameState` is plain data from `../logic/game` — so,
 * like `canvas.test.ts`, this runs under the default `node` environment.
 *
 * Cases, round 3 addendum (Stage 6 review): beyond the four reachable
 * `GameState.status` values, the case matrix also covers `cellSize = 1`
 * (the lower bound `computeCanvasMetrics` ever produces — see its own
 * "never produces a cell size below 1" test in `canvas.test.ts`) and a
 * near-full snake (draws close to `gridWidth * gridHeight` segments, the
 * top end of `drawSnake`'s loop rather than its near-empty short cases,
 * which the other cases already cover via `initialSnakeLength`'s
 * default of 3). Both are cheap and close an otherwise-open gap; neither
 * is expected to find anything (no division by `cellSize`, no indexing
 * derived from `score`), per the reviewer.
 */
function buildCases(): ReadonlyArray<{ readonly label: string; readonly state: GameState; readonly cellSize: number }> {
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

  return [
    { label: 'status "ready"', state: ready, cellSize: 20 },
    { label: 'status "running"', state: running, cellSize: 20 },
    { label: 'status "paused"', state: paused, cellSize: 20 },
    { label: 'status "over"', state: over, cellSize: 20 },
    { label: 'the minimum cellSize computeCanvasMetrics ever produces', state: running, cellSize: 1 },
    { label: 'a near-full snake (99 of 100 cells)', state: buildNearFullSnakeState(), cellSize: 20 },
  ];
}

/**
 * Hand-built rather than reached by play: `createGame`'s
 * `buildInitialSnake` lays the snake out in a straight horizontal line
 * from the centre, so an `initialSnakeLength` anywhere near
 * `gridWidth * gridHeight` runs the head off into negative x long
 * before the snake is actually near-full. `render` only reads `snake`,
 * `food`, `config`, `status` and `score` as plain data (it is read-only
 * and makes no game-rule decisions either way), so constructing a
 * `GameState` directly — a raster-scan snake covering all but one cell
 * of a 10x10 grid, food on the one cell left over — is the direct way
 * to reach this shape without depending on `createGame`/`step`'s
 * unrelated placement behaviour.
 */
function buildNearFullSnakeState(): GameState {
  const gridWidth = 10;
  const gridHeight = 10;
  const totalCells = gridWidth * gridHeight;
  const snake: Position[] = [];
  for (let i = 0; i < totalCells - 1; i += 1) {
    snake.push({ x: i % gridWidth, y: Math.floor(i / gridWidth) });
  }
  const food: Position = { x: gridWidth - 1, y: gridHeight - 1 };

  return {
    status: 'running',
    config: { gridWidth, gridHeight },
    snake,
    direction: 'right',
    queuedDirection: null,
    food,
    score: totalCells - 1 - 3,
    initial: { snake, direction: 'right', food },
  };
}

describe('render (smoke test)', () => {
  const cases = buildCases();
  const timestamps = [0, 700, -500];

  for (const { label, state, cellSize } of cases) {
    for (const timestampMs of timestamps) {
      it(`does not throw for ${label} at timestamp ${timestampMs} (cellSize ${cellSize})`, () => {
        const ctx = createFakeCanvasContext();
        expect(() => render(ctx, state, cellSize, timestampMs)).not.toThrow();
      });
    }
  }
});
