/**
 * Unit tests for the pure keyboard mapper (`keyToAction`) and the
 * `bindKeyboard` wiring, using a fake `EventTarget` — no jsdom here. The
 * one required jsdom integration test lives in `keyboard.integration.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GameAction, GameStatus } from '../logic/game';
import { bindKeyboard, keyToAction } from './keyboard';

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

  it.each(['r', 'R'] as const)('maps %s to restart regardless of status', (key) => {
    expect(keyToAction(key, runningStatus)).toEqual({ type: 'restart' });
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

function fakeKeydown(key: string): Event {
  return {
    type: 'keydown',
    key,
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
});
