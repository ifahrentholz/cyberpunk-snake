/**
 * Unit tests for the pure keyboard mapper (`keyToAction`) and the
 * `bindKeyboard` wiring, using a fake `EventTarget` — no jsdom here. The
 * one required jsdom integration test lives in `keyboard.integration.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GameAction, GameStatus } from '../logic/game';
import { bindKeyboard, keyToAction } from './keyboard';

const ALL_STATUSES = ['ready', 'running', 'paused', 'over'] as const;

describe('keyToAction', () => {
  const runningStatus: GameStatus = 'running';

  it.each([
    ['ArrowUp', 'up'],
    ['ArrowDown', 'down'],
    ['ArrowLeft', 'left'],
    ['ArrowRight', 'right'],
  ] as const)('maps arrow key %s to direction %s', (key, direction) => {
    expect(keyToAction(key, runningStatus)).toEqual({ type: 'direction', direction });
  });

  it.each([
    ['w', 'up'],
    ['W', 'up'],
    ['s', 'down'],
    ['S', 'down'],
    ['a', 'left'],
    ['A', 'left'],
    ['d', 'right'],
    ['D', 'right'],
  ] as const)('maps WASD key %s (case-insensitive) to direction %s', (key, direction) => {
    expect(keyToAction(key, runningStatus)).toEqual({ type: 'direction', direction });
  });

  it('maps Space to pause while running', () => {
    expect(keyToAction(' ', 'running')).toEqual({ type: 'pause' });
  });

  it('maps Space to resume while paused', () => {
    expect(keyToAction(' ', 'paused')).toEqual({ type: 'resume' });
  });

  it.each(['ready', 'over'] as const)(
    'maps Space to pause (a no-op for step) while status is %s',
    (status) => {
      expect(keyToAction(' ', status)).toEqual({ type: 'pause' });
    },
  );

  // FIX 4 (review finding): this used to pass a fixed 'running' status for
  // both 'r' and 'R', so it never actually demonstrated the
  // status-independence its name claims. Now it varies the status across
  // every GameStatus value for both cases.
  it.each(ALL_STATUSES.flatMap((status) => [
    ['r', status],
    ['R', status],
  ] as const))('maps %s to restart regardless of status (status: %s)', (key, status) => {
    expect(keyToAction(key, status)).toEqual({ type: 'restart' });
  });

  it('returns null for an unbound key', () => {
    expect(keyToAction('q', runningStatus)).toBeNull();
  });
});

/** Minimal fake `EventTarget` so `bindKeyboard` can be unit-tested without jsdom. */
class FakeEventTarget implements EventTarget {
  private listeners = new Set<EventListenerOrEventListenerObject>();

  addEventListener(_type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (listener) {
      this.listeners.add(listener);
    }
  }

  removeEventListener(_type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (listener) {
      this.listeners.delete(listener);
    }
  }

  dispatchEvent(event: Event): boolean {
    for (const listener of this.listeners) {
      if (typeof listener === 'function') {
        listener(event);
      } else {
        listener.handleEvent(event);
      }
    }
    return true;
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

interface FakeKeydownOverrides {
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly shiftKey?: boolean;
  readonly repeat?: boolean;
}

function fakeKeydown(key: string, overrides: FakeKeydownOverrides = {}): Event {
  return {
    type: 'keydown',
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    ...overrides,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent;
}

describe('bindKeyboard', () => {
  it('dispatches the mapped action for a recognised key and prevents default', () => {
    const target = new FakeEventTarget();
    const dispatch = vi.fn<(action: GameAction) => void>();
    bindKeyboard({ target, getStatus: () => 'running', dispatch });

    const event = fakeKeydown('ArrowUp');
    target.dispatchEvent(event);

    expect(dispatch).toHaveBeenCalledWith({ type: 'direction', direction: 'up' });
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it('does not dispatch or preventDefault for an unbound key', () => {
    const target = new FakeEventTarget();
    const dispatch = vi.fn<(action: GameAction) => void>();
    bindKeyboard({ target, getStatus: () => 'running', dispatch });

    const event = fakeKeydown('q');
    target.dispatchEvent(event);

    expect(dispatch).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('stops dispatching once unbound', () => {
    const target = new FakeEventTarget();
    const dispatch = vi.fn<(action: GameAction) => void>();
    const unbind = bindKeyboard({ target, getStatus: () => 'running', dispatch });

    unbind();
    target.dispatchEvent(fakeKeydown('ArrowDown'));

    expect(dispatch).not.toHaveBeenCalled();
    expect(target.listenerCount).toBe(0);
  });

  // FIX 1 (review finding, BLOCKING): Cmd/Ctrl/Alt + a bound key must not
  // reach the game and must not swallow the browser/OS shortcut. Without
  // this guard, Cmd/Ctrl+R maps to `restart` and eats the reload shortcut.
  it.each(['ctrlKey', 'metaKey', 'altKey'] as const)(
    'ignores a recognised key when %s is held, and does not preventDefault (so the browser shortcut still fires)',
    (modifier) => {
      const target = new FakeEventTarget();
      const dispatch = vi.fn<(action: GameAction) => void>();
      bindKeyboard({ target, getStatus: () => 'running', dispatch });

      const event = fakeKeydown('r', { [modifier]: true });
      target.dispatchEvent(event);

      expect(dispatch).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    },
  );

  it('still dispatches and prevents default when only shiftKey is held (Shift is not a guarded modifier)', () => {
    const target = new FakeEventTarget();
    const dispatch = vi.fn<(action: GameAction) => void>();
    bindKeyboard({ target, getStatus: () => 'running', dispatch });

    const event = fakeKeydown('ArrowUp', { shiftKey: true });
    target.dispatchEvent(event);

    expect(dispatch).toHaveBeenCalledWith({ type: 'direction', direction: 'up' });
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  // FIX 2 (review finding, BLOCKING): OS key-repeat must not reach the
  // game. Direct check that a repeat event is dropped and its default not
  // suppressed.
  it('ignores a repeated keydown (event.repeat) and does not preventDefault', () => {
    const target = new FakeEventTarget();
    const dispatch = vi.fn<(action: GameAction) => void>();
    bindKeyboard({ target, getStatus: () => 'running', dispatch });

    const event = fakeKeydown(' ', { repeat: true });
    target.dispatchEvent(event);

    expect(dispatch).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  // The scenario the reviewer actually found: without a repeat guard, a
  // held Space bar re-fires keydown while getStatus() is live, so the
  // toggle recomputes on every repeat and the final state depends on
  // repeat-count parity. This proves one physical press produces exactly
  // one toggle, no matter how many repeats fire before release.
  it('a held Space toggles pause exactly once, ignoring the repeat bursts in between', () => {
    const target = new FakeEventTarget();
    let status: GameStatus = 'running';
    const dispatch = vi.fn((action: GameAction) => {
      if (action.type === 'pause') status = 'paused';
      if (action.type === 'resume') status = 'running';
    });
    bindKeyboard({ target, getStatus: () => status, dispatch });

    target.dispatchEvent(fakeKeydown(' '));
    target.dispatchEvent(fakeKeydown(' ', { repeat: true }));
    target.dispatchEvent(fakeKeydown(' ', { repeat: true }));
    target.dispatchEvent(fakeKeydown(' ', { repeat: true }));

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'pause' });
    expect(status).toBe('paused');
  });
});
