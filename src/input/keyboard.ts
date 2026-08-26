/**
 * Keyboard input binding (issue #5).
 *
 * `keyToAction` is a pure mapper from a raw `KeyboardEvent.key` value plus
 * the current game status to a `GameAction | null`. It knows nothing about
 * the DOM. `bindKeyboard` is the thin, impure seam that attaches a real
 * `keydown` listener to an event target, calls the mapper, and forwards the
 * result into the game — this is the one place in this file allowed to
 * touch `KeyboardEvent`/`EventTarget`.
 *
 * Space toggles pause/resume, but the logic layer (`src/logic/game.ts`) only
 * exposes separate `pause` and `resume` actions — there is no toggle action
 * there, and that file is off limits. So the toggle decision lives here,
 * driven by the status the caller reports: emit `resume` when the game is
 * currently paused, `pause` otherwise. `step` already treats `pause` as a
 * no-op unless `status === 'running'` and `resume` as a no-op unless
 * `status === 'paused'`, so routing every other status through `pause` is
 * safe and needs no extra branching here.
 */
import type { GameAction, GameStatus } from '../logic/game';

/**
 * Maps a keyboard key to the `GameAction` it represents, or `null` if the
 * key is not bound to anything. Letter keys are matched case-insensitively
 * so caps lock does not break movement or restart.
 *
 * Deliberately takes only `(key, status)`, not a `KeyboardEvent` — modifier
 * and repeat handling are DOM/browser concerns and live in `bindKeyboard`'s
 * `handleKeyDown`, not here, so this mapper stays free of DOM types.
 */
export function keyToAction(key: string, status: GameStatus): GameAction | null {
  switch (key) {
    case 'ArrowUp':
    case 'w':
    case 'W':
      return { type: 'direction', direction: 'up' };
    case 'ArrowDown':
    case 's':
    case 'S':
      return { type: 'direction', direction: 'down' };
    case 'ArrowLeft':
    case 'a':
    case 'A':
      return { type: 'direction', direction: 'left' };
    case 'ArrowRight':
    case 'd':
    case 'D':
      return { type: 'direction', direction: 'right' };
    case ' ':
      return status === 'paused' ? { type: 'resume' } : { type: 'pause' };
    case 'r':
    case 'R':
      return { type: 'restart' };
    default:
      return null;
  }
}

export interface KeyboardBindingOptions {
  /** Event target the real `keydown` listener is attached to. */
  readonly target: EventTarget;
  /** Reports the current status so Space can decide pause vs. resume. */
  readonly getStatus: () => GameStatus;
  /** Receives the mapped action for every recognised key. */
  readonly dispatch: (action: GameAction) => void;
}

/**
 * Attaches a `keydown` listener to `target` that maps each key through
 * `keyToAction` and forwards recognised actions to `dispatch`.
 *
 * Two guards run before the mapper, both bailing out with no dispatch and
 * no `preventDefault()`:
 *
 * - Modifier guard (`ctrlKey`/`metaKey`/`altKey`): without it, browser/OS
 *   shortcuts collide with our bindings — Cmd/Ctrl+R would map to
 *   `restart` and swallow the reload shortcut, Ctrl+A to `left`, etc.
 *   Suppressing `preventDefault()` here matters as much as suppressing the
 *   dispatch: swallowing the browser's own shortcut is the harm. `shiftKey`
 *   is deliberately excluded — no browser shortcut or game meaning collides
 *   with Shift+Arrow or Shift+letter, so guarding it would only cost a
 *   player who holds Shift their control of the snake for no reason.
 * - Repeat guard (`event.repeat`): OS key-repeat re-fires `keydown` while a
 *   key is held. That is harmless for directions/restart (re-queuing the
 *   same value is idempotent) but not for Space: `keyToAction` recomputes
 *   the toggle from the live `getStatus()` on every event, so a held space
 *   bar would produce a burst of alternating pause/resume dispatches whose
 *   final effect depends on repeat-count parity. One press must be one
 *   toggle, so repeats are ignored uniformly for every bound key rather
 *   than singling Space out.
 *
 * `preventDefault()` itself is called only for keys that make it past both
 * guards and map to an action — arrows and Space would otherwise scroll the
 * page — so unbound keys are left alone.
 *
 * Returns an unbind function that removes the listener.
 */
export function bindKeyboard({ target, getStatus, dispatch }: KeyboardBindingOptions): () => void {
  const handleKeyDown = (event: Event): void => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.ctrlKey || keyboardEvent.metaKey || keyboardEvent.altKey) {
      return;
    }
    if (keyboardEvent.repeat) {
      return;
    }
    const action = keyToAction(keyboardEvent.key, getStatus());
    if (action === null) {
      return;
    }
    keyboardEvent.preventDefault();
    dispatch(action);
  };

  target.addEventListener('keydown', handleKeyDown);
  return () => target.removeEventListener('keydown', handleKeyDown);
}
