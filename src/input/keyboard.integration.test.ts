// @vitest-environment jsdom
/**
 * Seam 2 integration test (issue #5): the ONE test in this codebase that
 * dispatches a real `keydown` event on the bound event target and asserts
 * the resulting state produced through the real logic API (`createGame` /
 * `step`). Everything else about keyboard handling is covered by the pure
 * unit tests in `keyboard.test.ts`; game rules are covered by
 * `src/logic/game.test.ts`. This test asserts only the wiring — which
 * direction ended up queued — and makes no game-rule assertion.
 */
import { describe, expect, it } from 'vitest';
import { createGame, step, type GameState } from '../logic/game';
import { bindKeyboard } from './keyboard';

describe('keyboard binding (integration)', () => {
  it('a real ArrowUp keydown on the bound target queues the "up" direction in the game state', () => {
    let state: GameState = createGame({ gridWidth: 10, gridHeight: 10 }, () => 0);

    const unbind = bindKeyboard({
      target: document,
      getStatus: () => state.status,
      dispatch: (action) => {
        state = step(state, action);
      },
    });

    // FIX 3 (review finding): unbind in `finally` so a failing assertion
    // above still detaches the listener from `document`. Left attached, a
    // failure here would leave a dangling listener that keeps reacting to
    // keydowns dispatched by tests that run later in the same jsdom
    // environment — inert today because this file holds exactly one test,
    // but not the moment a second one is added.
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));

      expect(state.queuedDirection).toBe('up');
    } finally {
      unbind();
    }
  });
});
