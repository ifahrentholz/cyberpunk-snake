/**
 * Canvas 2D renderer (issue #6).
 *
 * Reads `GameState` and a `CanvasRenderingContext2D` and draws. Never
 * mutates game state and makes no game-rule decisions — it is a pure
 * function of state to pixels (plus the DOM canvas element it draws
 * into). This is deliberately a plain, baseline look: solid fills,
 * readable contrast, no cyberpunk palette/glow/pulse/scanlines. That
 * visual treatment is issue #16, blocked by this one; see its ticket for
 * the full design-token contract.
 *
 * `COLORS` is the single place the few colours used here live, precisely
 * so #16 can swap values instead of hunting literals through the drawing
 * functions.
 *
 * AC16 (issue #6): no test may assert on canvas output, pixel data or
 * draw-call snapshots — this module is verified by eyeballing `npm run
 * dev`, not by unit test. The one piece of this file worth unit-testing
 * without a DOM is `computeCanvasMetrics`, the pure sizing/DPR math below.
 */
import type { GameState } from '../logic/game';

export const COLORS = {
  background: '#101018',
  hud: '#f5f5f5',
  snake: '#2f7bff',
  food: '#39d98a',
  overlay: 'rgba(0, 0, 0, 0.72)',
  overlayText: '#ffffff',
} as const;

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
 * Draws the current `GameState` into `ctx` at the given cell size (in CSS
 * pixels — the caller is expected to have already applied the DPR
 * transform via `resizeCanvas`). The sole entry point the composition
 * layer calls once per animation frame.
 */
export function render(ctx: CanvasRenderingContext2D, state: GameState, cellSize: number): void {
  const width = state.config.gridWidth * cellSize;
  const height = state.config.gridHeight * cellSize;

  drawBackground(ctx, width, height);
  drawFood(ctx, state.food, cellSize);
  drawSnake(ctx, state.snake, cellSize);
  drawHud(ctx, state.score, width);

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
}

function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);
}

function drawFood(ctx: CanvasRenderingContext2D, food: GameState['food'], cellSize: number): void {
  ctx.fillStyle = COLORS.food;
  ctx.fillRect(food.x * cellSize, food.y * cellSize, cellSize, cellSize);
}

function drawSnake(ctx: CanvasRenderingContext2D, snake: GameState['snake'], cellSize: number): void {
  ctx.fillStyle = COLORS.snake;
  for (const segment of snake) {
    ctx.fillRect(segment.x * cellSize, segment.y * cellSize, cellSize, cellSize);
  }
}

function drawHud(ctx: CanvasRenderingContext2D, score: number, width: number): void {
  ctx.fillStyle = COLORS.hud;
  ctx.font = '16px monospace';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(`Score: ${score}`, 8, 8);
  void width;
}

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  title: string,
  lines: readonly string[],
): void {
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
