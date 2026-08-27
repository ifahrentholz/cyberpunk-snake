/**
 * Renderer layer — reads game state and draws to a Canvas 2D context.
 *
 * May import from `logic` only, and stays read-only with respect to game
 * state. The real renderer (issue #6) lives in `./canvas` and is
 * re-exported below.
 */
export { COLORS, render, resizeCanvas, computeCanvasMetrics } from './canvas';
export type { CanvasMetrics } from './canvas';
