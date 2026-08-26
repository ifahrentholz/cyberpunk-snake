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
 * `preventDefault()` is called only for keys that actually map to an
 * action — arrows and Space would otherwise scroll the page — so unbound
 * keys are left alone.
 *
 * Returns an unbind function that removes the listener.
 */
export function bindKeyboard({ target, getStatus, dispatch }: KeyboardBindingOptions): () => void {
  const handleKeyDown = (event: Event): void => {
    const keyboardEvent = event as KeyboardEvent;
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
