/**
 * Fixed-tickrate composition loop (issue #6).
 *
 * This is the one place in the app where wall-clock time enters the
 * program. `src/logic/game.ts` stays pure and clock-free (issue #1); this
 * module drives it from the outside with a `requestAnimationFrame` loop
 * that accumulates elapsed time and calls back once per fixed-size tick,
 * decoupled from the browser's variable frame rate.
 *
 * `accumulate` is the pure core and the only part of this file worth a
 * unit test without a DOM or a fake clock: given how much time carried
 * over from the previous frame and how much elapsed this frame, how many
 * ticks should fire now, and how much time carries into the next frame.
 * `startTickLoop` is the thin, impure wrapper that drives it with a real
 * (or injected) `requestAnimationFrame`.
 */

/**
 * A single frame's tick accounting. Capped by `MAX_CATCHUP_TICKS` so a
 * huge `deltaMs` (a backgrounded tab regaining focus, a debugger pause)
 * cannot demand thousands of catch-up ticks in one frame: past the cap,
 * the loop deliberately drops the surplus time instead of queueing it as
 * debt. Queueing it would either run a burst of ticks so large the frame
 * itself stalls (the classic "spiral of death", where each stall produces
 * an even bigger `deltaMs` next frame) or, if spread out, leave the game
 * visibly catching up in fast motion. Losing a fraction of a second of
 * simulated time after a tab was hidden is not observable as a bug; a
 * multi-second burst of moves is.
 */
export interface AccumulateResult {
  readonly ticks: number;
  readonly carryMs: number;
}

/** How many ticks a single frame is allowed to catch up on at most. */
export const MAX_CATCHUP_TICKS = 5;

/**
 * Pure step of the fixed-tickrate accumulator. No DOM, no clock: every
 * input is a parameter, so it is testable with plain numbers.
 */
export function accumulate(carryMs: number, deltaMs: number, tickMs: number): AccumulateResult {
  if (tickMs <= 0) {
    throw new Error('tickMs must be a positive number');
  }
  // A negative deltaMs (a monotonic-clock hiccup) has no reasonable
  // interpretation as elapsed time; treat it as "no time passed" rather
  // than letting it null out real carried-over time.
  const safeDeltaMs = deltaMs > 0 ? deltaMs : 0;
  const maxCarryMs = MAX_CATCHUP_TICKS * tickMs;
  const totalMs = Math.min(carryMs + safeDeltaMs, maxCarryMs);
  const ticks = Math.floor(totalMs / tickMs);
  const carryMs2 = totalMs - ticks * tickMs;
  return { ticks, carryMs: carryMs2 };
}

export interface TickLoopOptions {
  /** Fixed tick duration in milliseconds (e.g. ~111ms for 9 ticks/second). */
  readonly tickMs: number;
  /**
   * Invoked once per accumulated tick. May throw (e.g. `step` propagating
   * `pickFoodPosition`'s full-grid exception) — the loop catches that,
   * reports it via `onError` and stops itself rather than silently
   * freezing on the last drawn frame.
   */
  readonly onTick: () => void;
  /** Invoked once per animation frame, after any ticks for that frame. */
  readonly onFrame: (timestampMs: number) => void;
  /** Reports an error caught from `onTick`. Defaults to `console.error`. */
  readonly onError?: (error: unknown) => void;
  /** Injectable for tests; defaults to the global `requestAnimationFrame`. */
  readonly requestFrame?: (callback: (timestampMs: number) => void) => number;
  /** Injectable for tests; defaults to the global `cancelAnimationFrame`. */
  readonly cancelFrame?: (handle: number) => void;
}

// The visible log this ticket's exception guard requires; see issue #6 AC
// "step call ... guarded".
function defaultOnError(error: unknown): void {
  console.error('[cyberpunk-snake] tick loop stopped after an unexpected error', error);
}

/**
 * Starts a `requestAnimationFrame` loop that calls `onTick` at a fixed
 * rate (via `accumulate`) and `onFrame` once per animation frame. Returns
 * a `stop` function that cancels the loop; safe to call more than once.
 */
export function startTickLoop(options: TickLoopOptions): () => void {
  const requestFrame = options.requestFrame ?? requestAnimationFrame;
  const cancelFrame = options.cancelFrame ?? cancelAnimationFrame;
  const onError = options.onError ?? defaultOnError;

  let carryMs = 0;
  let lastTimestampMs: number | null = null;
  let handle = 0;
  let stopped = false;

  const frame = (timestampMs: number): void => {
    if (stopped) {
      return;
    }
    const deltaMs = lastTimestampMs === null ? 0 : timestampMs - lastTimestampMs;
    lastTimestampMs = timestampMs;

    const result = accumulate(carryMs, deltaMs, options.tickMs);
    carryMs = result.carryMs;

    for (let i = 0; i < result.ticks; i += 1) {
      try {
        options.onTick();
      } catch (error) {
        stopped = true;
        onError(error);
        break;
      }
    }

    // Render the frame even if a tick just failed, so the last valid
    // state (or whatever the caller's error handling produced) is still
    // drawn instead of leaving stale pixels on screen with no feedback.
    options.onFrame(timestampMs);

    if (!stopped) {
      handle = requestFrame(frame);
    }
  };

  handle = requestFrame(frame);

  return () => {
    stopped = true;
    cancelFrame(handle);
  };
}
