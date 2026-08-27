/**
 * Composition entry point — the only place allowed to wire the logic,
 * input, renderer and persistence layers together (issue #1). This is
 * also where the fixed-tickrate `requestAnimationFrame` loop lives.
 *
 * Two things live at this boundary and nowhere else, by design:
 *
 * - `Math.random` is fed in as the `rng` for `createGame` and for every
 *   `tick` action. It must not appear in `src/logic`, `src/input` or
 *   `src/renderer` — the logic layer's ESLint allow-list forbids it
 *   mechanically, and it is simply not imported/used in the other two.
 *   This is the one, visible, checkable place non-determinism enters the
 *   program (issue #4 AC3 / issue #6 contract addendum A).
 * - The `step` call the tick loop drives is guarded: `pickFoodPosition`
 *   throwing on a full grid must not silently freeze the game on the
 *   last drawn frame. `startTickLoop` (see `./composition/loop`) already
 *   catches, logs and stops the loop; `handleFatalTickError` below adds
 *   a visible, orderly UI state on top (issue #6 contract addendum B).
 *   No new game mechanic or win condition is introduced.
 */
import { createGame, step, type GameAction, type GameState } from './logic/game';
import { bindKeyboard } from './input/keyboard';
import { render, resizeCanvas } from './renderer';
import { readHighscorePlaceholder } from './persistence';
import { startTickLoop } from './composition/loop';

/** AC5: a 28×28 grid. */
const GRID_WIDTH = 28;
const GRID_HEIGHT = 28;

/** AC1: a fixed tick rate within 8–10 ticks/second. */
const TICK_RATE_HZ = 9;
const TICK_MS = 1000 / TICK_RATE_HZ;

export interface AppComposition {
  readonly canvas: HTMLCanvasElement;
  readonly getState: () => GameState;
  readonly dispatch: (action: GameAction) => void;
  /** Test seam: runs exactly what one tick-loop tick would run. */
  readonly advanceTick: () => void;
  readonly stop: () => void;
  readonly highscore: number;
}

function mountCanvas(doc: Document): HTMLCanvasElement {
  const existing = doc.getElementById('game-canvas');
  if (existing instanceof HTMLCanvasElement) {
    return existing;
  }
  const canvas = doc.createElement('canvas');
  canvas.id = 'game-canvas';
  (doc.getElementById('app') ?? doc.body).appendChild(canvas);
  return canvas;
}

function failMissingWindow(): never {
  throw new Error('composeApp requires a document with a window (defaultView)');
}

function mountErrorBanner(doc: Document): HTMLElement {
  const existing = doc.getElementById('error-banner');
  if (existing) {
    return existing;
  }
  const banner = doc.createElement('div');
  banner.id = 'error-banner';
  banner.setAttribute('role', 'alert');
  banner.hidden = true;
  (doc.getElementById('app') ?? doc.body).appendChild(banner);
  return banner;
}

/**
 * Wires logic, input, renderer and persistence into a running app bound
 * to `doc`. Returns the handles a caller (production bootstrap, or a
 * test) needs: read the live state, dispatch actions directly, drive one
 * tick without waiting on `requestAnimationFrame`, and tear everything
 * down again.
 */
export function composeApp(doc: Document = document): AppComposition {
  const canvas = mountCanvas(doc);
  const errorBanner = mountErrorBanner(doc);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D canvas context is not available');
  }
  const view: Window = doc.defaultView ?? failMissingWindow();

  let state: GameState = createGame({ gridWidth: GRID_WIDTH, gridHeight: GRID_HEIGHT }, Math.random);
  let cellSize = resizeCanvas(canvas, GRID_WIDTH, GRID_HEIGHT, view);

  // AC3/AC4: the start screen must show before any movement begins, and
  // the first direction key press must be the first move. `step` itself
  // moves the snake on every non-paused, non-over tick regardless of
  // status (see src/logic/game.ts `advance`) — starting is a composition
  // concern, not a logic-layer one, so it is tracked here: ticks are
  // withheld until the player has issued at least one direction action
  // while the game was still 'ready'. Reset on every restart.
  let awaitingFirstMove = true;

  function dispatch(action: GameAction): void {
    const wasReady = state.status === 'ready';
    state = step(state, action);
    if (action.type === 'restart') {
      awaitingFirstMove = true;
    } else if (wasReady && action.type === 'direction') {
      awaitingFirstMove = false;
    }
  }

  function advanceTick(): void {
    // `step` already treats a 'tick' as a no-op while paused or over (see
    // src/logic/game.ts `step`), so the only thing this composition-level
    // guard needs to add is withholding the very first tick until a
    // direction key has actually been pressed (AC3/AC4) — including the
    // first tick while `status` is still 'ready', which is the one that
    // flips it to 'running'.
    if (awaitingFirstMove) {
      return;
    }
    dispatch({ type: 'tick', rng: Math.random });
  }

  const unbindKeyboard = bindKeyboard({
    target: doc,
    getStatus: () => state.status,
    dispatch,
  });

  function handleResize(): void {
    cellSize = resizeCanvas(canvas, GRID_WIDTH, GRID_HEIGHT, view);
  }
  view.addEventListener('resize', handleResize);

  function handleFatalTickError(error: unknown): void {
    console.error('[cyberpunk-snake] tick loop stopped after an unexpected error', error);
    errorBanner.textContent = 'Something went wrong and the game had to stop. Reload the page to play again.';
    errorBanner.hidden = false;
  }

  const stopLoop = startTickLoop({
    tickMs: TICK_MS,
    onTick: advanceTick,
    onFrame: () => render(ctx, state, cellSize),
    onError: handleFatalTickError,
    requestFrame: view.requestAnimationFrame.bind(view),
    cancelFrame: view.cancelAnimationFrame.bind(view),
  });

  return {
    canvas,
    getState: () => state,
    dispatch,
    advanceTick,
    stop: () => {
      stopLoop();
      unbindKeyboard();
      view.removeEventListener('resize', handleResize);
    },
    highscore: readHighscorePlaceholder(),
  };
}

// Only bootstrap for real in the browser, not when this module is imported
// under the jsdom test environment.
if (typeof document !== 'undefined' && import.meta.env.MODE !== 'test') {
  composeApp(document);
}
