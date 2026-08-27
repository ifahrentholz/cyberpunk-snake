/**
 * Canvas 2D renderer (issue #6, cyberpunk visual treatment in #16).
 *
 * Reads `GameState` and a `CanvasRenderingContext2D` and draws. Never
 * mutates game state and makes no game-rule decisions — it is a pure
 * function of state (plus a caller-supplied timestamp, see below) to
 * pixels and the DOM canvas element it draws into.
 *
 * `COLORS` is the single design-token object every colour in this file
 * comes from (issue #16 AC1) — nothing here is a scattered literal.
 *
 * Two things worth knowing before touching this file:
 *
 * - `shadowBlur`/`shadowColor` are canvas *context state*, not per-call
 *   arguments: once set, they apply to every subsequent draw call until
 *   changed again. Before #16 this file had no `save()`/`restore()`
 *   anywhere because every draw function reset `textAlign`/`textBaseline`
 *   before use, so nothing could leak between frames. Glow changes that:
 *   every function below that turns a shadow on turns it back off again
 *   (via `resetShadow`) before returning, and text-drawing functions
 *   reset defensively on entry too — belt and braces against a glow
 *   leaking onto the HUD or an overlay. `save()`/`restore()` were
 *   deliberately not introduced instead: this file's fake `ctx` test
 *   double (`src/main.test.ts`) only stubs `fillRect`/`fillText`/
 *   `setTransform`, so an explicit reset keeps the drawing surface to
 *   methods that double already provides.
 * - The food's pulse is a pure function of a timestamp handed in by the
 *   caller (`render`'s fourth parameter), not of `performance.now()`,
 *   `Date.now()` or a mutable phase counter held in this module. Per
 *   ADR-0006, `src/composition/loop.ts`'s tick loop is the one place
 *   wall-clock time enters this program; `startTickLoop` already calls
 *   `onFrame(timestampMs)`, and `src/main.ts` now threads that value
 *   through into `render`. See `computeFoodPulseFactor` /
 *   `computeFoodPulseMetrics` below — both pure, both unit-tested
 *   without a DOM in `canvas.test.ts`.
 *
 * AC (issue #16): no test may assert on canvas output, pixel data or
 * draw-call snapshots. Two kinds of test exist instead (Stage 6 review
 * of #16 closed a real gap here: before it, `render` was invoked exactly
 * once across the whole suite, and that one call threw immediately in
 * `drawBackground`, so nothing below it ever ran):
 * - Pure math, no DOM: `computeCanvasMetrics` (sizing/DPR) and
 *   `computeFoodPulseFactor`/`computeFoodPulseMetrics` (the food pulse),
 *   in `canvas.test.ts`.
 * - A smoke test for `render` itself, in `canvas.render.test.ts`: calls
 *   it for every reachable `GameState.status` and a spread of
 *   timestamps, asserting only that it does not throw — nothing about
 *   what was drawn.
 * What this file's drawing actually looks like is still verified by
 * eyeballing `npm run dev`, not by either kind of test.
 */
import type { GameState } from '../logic/game';

/**
 * The cyberpunk palette (issue #16 AC1). Every colour used anywhere in
 * this file is a `COLORS.*` reference — swap values here, not literals
 * scattered through the drawing functions below.
 */
export const COLORS = {
  background: '#05060a',
  grid: '#0e2a33',
  snakeHead: '#7dfdfe',
  snakeBody: '#00e5ff',
  food: '#ff2fb3',
  hud: '#e8fbff',
  overlay: 'rgba(0, 0, 0, 0.72)',
  overlayText: '#e8fbff',
  scanline: 'rgba(5, 6, 10, 0.35)',
} as const;

/**
 * Glow (`shadowBlur`) magnitudes, in pixels, for each glowing element.
 * Kept together rather than as inline magic numbers, same reasoning as
 * `COLORS`. Not part of the design-token *colour* contract (AC1 only
 * mandates colours), just a tidy home for the numbers.
 */
const GLOW = {
  grid: 4,
  snakeHead: 14,
  snakeBody: 8,
  foodMin: 6,
  foodMax: 16,
} as const;

/** How far apart the scanline overlay's horizontal lines are, in CSS px. */
const SCANLINE_SPACING = 3;
const SCANLINE_THICKNESS = 1;

/** Full pulse-cycle length for the food's pulsing animation, in ms. */
const FOOD_PULSE_PERIOD_MS = 1400;
/**
 * How far (as a fraction of cell size) the food may shrink at the
 * pulse's smallest point. Exported (Stage 6 review of #16) because a
 * test pins the real precondition `computeFoodPulseMetrics`'s clamps
 * rely on: this must stay below 0.5, or an unclamped inset would reach
 * (and past 0.5, exceed) `cellSize` and draw a negative-sized food. See
 * `canvas.test.ts`'s `FOOD_PULSE_MAX_INSET_RATIO` describe block.
 */
export const FOOD_PULSE_MAX_INSET_RATIO = 0.22;

/** Result of the pure canvas-sizing calculation. All sizes in pixels. */
export interface CanvasMetrics {
  /** Size of one grid cell, in CSS pixels. */
  readonly cellSize: number;
  /** Canvas CSS (layout) size — what `canvas.style.width/height` get. */
  readonly cssWidth: number;
  readonly cssHeight: number;
  /** Canvas backing-store size — what `canvas.width/height` get. */
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

/**
 * Pure sizing math for AC5 (28×28 grid, scaled into the viewport keeping
 * aspect ratio, `devicePixelRatio`-aware so edges stay crisp). No DOM: it
 * takes the viewport box and DPR as plain numbers, so it is testable
 * without jsdom.
 */
export function computeCanvasMetrics(
  gridWidth: number,
  gridHeight: number,
  availableWidth: number,
  availableHeight: number,
  devicePixelRatio: number,
): CanvasMetrics {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const cellSize = Math.max(1, Math.floor(Math.min(availableWidth / gridWidth, availableHeight / gridHeight)));
  const cssWidth = cellSize * gridWidth;
  const cssHeight = cellSize * gridHeight;
  return {
    cellSize,
    cssWidth,
    cssHeight,
    pixelWidth: Math.round(cssWidth * dpr),
    pixelHeight: Math.round(cssHeight * dpr),
  };
}

/**
 * Impure wrapper: reads the viewport/DPR from `view`, applies
 * `computeCanvasMetrics` to a real canvas element (backing-store size,
 * CSS size, and a device-pixel-ratio transform on its 2D context) and
 * returns the resulting cell size for the caller to draw with.
 */
export function resizeCanvas(
  canvas: HTMLCanvasElement,
  gridWidth: number,
  gridHeight: number,
  view: Window,
): number {
  const availableWidth = view.innerWidth * 0.9;
  const availableHeight = view.innerHeight * 0.9;
  const metrics = computeCanvasMetrics(gridWidth, gridHeight, availableWidth, availableHeight, view.devicePixelRatio);

  canvas.width = metrics.pixelWidth;
  canvas.height = metrics.pixelHeight;
  canvas.style.width = `${metrics.cssWidth}px`;
  canvas.style.height = `${metrics.cssHeight}px`;

  const ctx = canvas.getContext('2d');
  const dpr = view.devicePixelRatio > 0 ? view.devicePixelRatio : 1;
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);

  return metrics.cellSize;
}

/**
 * Pure [0, 1] pulse factor from a tick-loop-supplied timestamp (ADR-0006:
 * the tick loop is the one place wall-clock time enters the program, so
 * this takes it as a parameter rather than reading a clock or holding a
 * mutable phase counter). `Math.sin` is mathematically bounded to
 * [-1, 1] for every finite input, including huge and negative
 * timestamps, but the result below is still explicitly clamped: nothing
 * downstream should have to trust that a periodic function "stays in
 * range" — an unclamped animation-derived radius crashing
 * `createRadialGradient` with `IndexSizeError` is the concrete failure
 * mode #6 guarded the tick loop against, and this is the same class of
 * bug at its source.
 */
export function computeFoodPulseFactor(timestampMs: number): number {
  const safeTimestampMs = Number.isFinite(timestampMs) ? timestampMs : 0;
  // JS `%` keeps the sign of its left operand, so a negative timestamp
  // gives a negative remainder; `(x % n + n) % n` normalises that into
  // [0, FOOD_PULSE_PERIOD_MS) before it becomes an angle.
  const cyclePosition = ((safeTimestampMs % FOOD_PULSE_PERIOD_MS) + FOOD_PULSE_PERIOD_MS) % FOOD_PULSE_PERIOD_MS;
  const wave = Math.sin((cyclePosition / FOOD_PULSE_PERIOD_MS) * Math.PI * 2);
  return Math.min(1, Math.max(0, (wave + 1) / 2));
}

/** The food's drawn size/offset/glow-blur for one frame, all pixel units. */
export interface FoodPulseMetrics {
  readonly size: number;
  readonly offset: number;
  readonly glowBlur: number;
}

/**
 * Derives the food's drawn size, its offset within the cell (to keep it
 * centred as it shrinks/grows) and its glow blur from the pulse factor.
 * Every value is clamped to non-negative before use: the size handed to
 * `fillRect` and the blur handed to `shadowBlur` must never go negative,
 * regardless of how extreme `timestampMs` or `cellSize` are.
 */
export function computeFoodPulseMetrics(timestampMs: number, cellSize: number): FoodPulseMetrics {
  const safeCellSize = Number.isFinite(cellSize) && cellSize > 0 ? cellSize : 0;
  const factor = computeFoodPulseFactor(timestampMs);
  const maxInset = safeCellSize * FOOD_PULSE_MAX_INSET_RATIO;
  const inset = Math.max(0, factor * maxInset);
  const size = Math.max(0, safeCellSize - inset * 2);
  const offset = Math.max(0, (safeCellSize - size) / 2);
  const glowBlur = Math.max(0, GLOW.foodMin + factor * (GLOW.foodMax - GLOW.foodMin));
  return { size, offset, glowBlur };
}

/** Turns off any glow left on `ctx` so it cannot leak onto the next draw call. */
function resetShadow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
}

/**
 * Draws the current `GameState` into `ctx` at the given cell size (in CSS
 * pixels — the caller is expected to have already applied the DPR
 * transform via `resizeCanvas`). The sole entry point the composition
 * layer calls once per animation frame.
 *
 * `timestampMs` is the animation-frame timestamp `startTickLoop` already
 * hands its `onFrame` callback (ADR-0006) — the only clock input this
 * module accepts, used solely to drive the food's decorative pulse. It
 * never affects `GameState`.
 */
export function render(ctx: CanvasRenderingContext2D, state: GameState, cellSize: number, timestampMs: number): void {
  const width = state.config.gridWidth * cellSize;
  const height = state.config.gridHeight * cellSize;

  // Defensive: a frame should never start with shadow state left over
  // from whatever last touched this context. Every function below also
  // resets after itself, so this is belt and braces, not the sole guard.
  resetShadow(ctx);

  drawBackground(ctx, width, height);
  drawGrid(ctx, state.config.gridWidth, state.config.gridHeight, cellSize);
  drawFood(ctx, state.food, cellSize, timestampMs);
  drawSnake(ctx, state.snake, cellSize);
  drawHud(ctx, state.score);

  if (state.status === 'ready') {
    drawOverlay(ctx, width, height, 'CYBERPUNK SNAKE', [
      'Arrows / WASD to move',
      'Space to pause',
      'R to restart',
      'Press a direction key to start',
    ]);
  } else if (state.status === 'paused') {
    drawOverlay(ctx, width, height, 'PAUSED', ['Space to resume']);
  } else if (state.status === 'over') {
    drawOverlay(ctx, width, height, 'GAME OVER', [`Score: ${state.score}`, 'R to restart']);
  }

  // Drawn last so the CRT-style scanline film sits over the whole frame,
  // gameplay and overlays alike.
  drawScanlines(ctx, width, height);
}

function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);
}

/** AC "a dim background grid is visible" + AC "grid renders with neon glow via shadowBlur/shadowColor". */
function drawGrid(ctx: CanvasRenderingContext2D, gridWidth: number, gridHeight: number, cellSize: number): void {
  const width = gridWidth * cellSize;
  const height = gridHeight * cellSize;
  const lineThickness = 1;

  ctx.fillStyle = COLORS.grid;
  ctx.shadowColor = COLORS.grid;
  ctx.shadowBlur = GLOW.grid;

  for (let col = 1; col < gridWidth; col += 1) {
    ctx.fillRect(col * cellSize - lineThickness / 2, 0, lineThickness, height);
  }
  for (let row = 1; row < gridHeight; row += 1) {
    ctx.fillRect(0, row * cellSize - lineThickness / 2, width, lineThickness);
  }

  resetShadow(ctx);
}

/** AC "food is rendered with a pulsing animation", driven by `computeFoodPulseMetrics`. */
function drawFood(ctx: CanvasRenderingContext2D, food: GameState['food'], cellSize: number, timestampMs: number): void {
  const { size, offset, glowBlur } = computeFoodPulseMetrics(timestampMs, cellSize);

  ctx.fillStyle = COLORS.food;
  ctx.shadowColor = COLORS.food;
  ctx.shadowBlur = glowBlur;
  ctx.fillRect(food.x * cellSize + offset, food.y * cellSize + offset, size, size);

  resetShadow(ctx);
}

/**
 * AC "snake head is visually distinct from the body" + AC "snake renders
 * with neon glow via shadowBlur/shadowColor". `snake[0]` is the head (see
 * `src/logic/game.ts`'s `advance`).
 */
function drawSnake(ctx: CanvasRenderingContext2D, snake: GameState['snake'], cellSize: number): void {
  // Shadow state is set once per colour, not once per segment (Stage 6
  // review of #16): every body segment shares the same colour/glow, so
  // re-setting shadowBlur/shadowColor on each of them was redundant
  // context churn for an identical value, not a correctness need. The
  // only real transition is head -> body.
  const [head, ...body] = snake;

  if (head) {
    ctx.fillStyle = COLORS.snakeHead;
    ctx.shadowColor = COLORS.snakeHead;
    ctx.shadowBlur = GLOW.snakeHead;
    ctx.fillRect(head.x * cellSize, head.y * cellSize, cellSize, cellSize);
  }

  if (body.length > 0) {
    ctx.fillStyle = COLORS.snakeBody;
    ctx.shadowColor = COLORS.snakeBody;
    ctx.shadowBlur = GLOW.snakeBody;
    for (const segment of body) {
      ctx.fillRect(segment.x * cellSize, segment.y * cellSize, cellSize, cellSize);
    }
  }

  resetShadow(ctx);
}

function drawHud(ctx: CanvasRenderingContext2D, score: number): void {
  // Defensive reset: the HUD is plain text and must never inherit glow
  // from whatever drew immediately before it.
  resetShadow(ctx);
  ctx.fillStyle = COLORS.hud;
  ctx.font = '16px monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(`Score: ${score}`, 8, 8);
}

/** AC "a subtle scanline overlay is visible over the playfield". Static — no timestamp needed. */
function drawScanlines(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = COLORS.scanline;
  for (let y = 0; y < height; y += SCANLINE_SPACING) {
    ctx.fillRect(0, y, width, SCANLINE_THICKNESS);
  }
}

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  title: string,
  lines: readonly string[],
): void {
  // Defensive reset: overlay text must never inherit glow from whatever
  // drew immediately before it.
  resetShadow(ctx);

  ctx.fillStyle = COLORS.overlay;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = COLORS.overlayText;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = 'bold 28px monospace';
  ctx.fillText(title, width / 2, height / 2 - (lines.length * 22) / 2 - 16);

  ctx.font = '16px monospace';
  lines.forEach((line, index) => {
    ctx.fillText(line, width / 2, height / 2 - (lines.length * 22) / 2 + 16 + index * 22);
  });
}
