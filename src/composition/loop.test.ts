import { describe, expect, it, vi } from 'vitest';
import { accumulate, MAX_CATCHUP_TICKS, startTickLoop } from './loop';

const TICK_MS = 100;

describe('accumulate', () => {
  it('produces one tick and carries the remainder for a single tick worth of delta', () => {
    const result = accumulate(0, 100, TICK_MS);
    expect(result).toEqual({ ticks: 1, carryMs: 0 });
  });

  it('produces multiple ticks for a large delta within the catch-up window', () => {
    const result = accumulate(0, 250, TICK_MS);
    expect(result.ticks).toBe(2);
    expect(result.carryMs).toBe(50);
  });

  it('produces zero ticks for a tiny delta and does not lose the time', () => {
    const result = accumulate(0, 5, TICK_MS);
    expect(result.ticks).toBe(0);
    expect(result.carryMs).toBe(5);
  });

  it('accumulates carried time across frames until it crosses a tick boundary', () => {
    const first = accumulate(0, 40, TICK_MS);
    expect(first).toEqual({ ticks: 0, carryMs: 40 });
    const second = accumulate(first.carryMs, 40, TICK_MS);
    expect(second).toEqual({ ticks: 0, carryMs: 80 });
    const third = accumulate(second.carryMs, 40, TICK_MS);
    expect(third).toEqual({ ticks: 1, carryMs: 20 });
  });

  it('caps ticks per frame instead of spiralling after a huge delta (tab switch)', () => {
    // A tab regaining focus after minutes away could report a multi-second
    // deltaMs. Without a cap this would demand thousands of catch-up
    // ticks in a single frame; capped, it demands at most
    // MAX_CATCHUP_TICKS and deliberately drops the rest.
    const result = accumulate(0, 60_000, TICK_MS);
    expect(result.ticks).toBe(MAX_CATCHUP_TICKS);
    expect(result.ticks).toBeLessThan(60_000 / TICK_MS);
  });

  it('caps combined carry + delta the same way, not just delta alone', () => {
    const almostFullCarry = (MAX_CATCHUP_TICKS - 1) * TICK_MS + 90;
    const result = accumulate(almostFullCarry, 5000, TICK_MS);
    expect(result.ticks).toBeLessThanOrEqual(MAX_CATCHUP_TICKS);
  });

  it('treats a negative delta (clock hiccup) as zero elapsed time', () => {
    const result = accumulate(30, -10, TICK_MS);
    expect(result).toEqual({ ticks: 0, carryMs: 30 });
  });

  it('throws for a non-positive tickMs', () => {
    expect(() => accumulate(0, 100, 0)).toThrow();
    expect(() => accumulate(0, 100, -1)).toThrow();
  });
});

describe('startTickLoop', () => {
  function makeFakeFrameSource() {
    const callbacks: Array<(timestampMs: number) => void> = [];
    return {
      requestFrame: (cb: (timestampMs: number) => void): number => {
        callbacks.push(cb);
        return callbacks.length;
      },
      cancelFrame: (): void => {
        // no-op fake; startTickLoop just needs a callable here.
      },
      fire: (timestampMs: number): void => {
        const cb = callbacks.shift();
        cb?.(timestampMs);
      },
      pending: (): number => callbacks.length,
    };
  }

  it('calls onTick at the fixed rate and onFrame once per animation frame', () => {
    const source = makeFakeFrameSource();
    const onTick = vi.fn();
    const onFrame = vi.fn();

    startTickLoop({
      tickMs: TICK_MS,
      onTick,
      onFrame,
      requestFrame: source.requestFrame,
      cancelFrame: source.cancelFrame,
    });

    source.fire(0); // seeds the clock, no elapsed time yet
    expect(onTick).not.toHaveBeenCalled();
    expect(onFrame).toHaveBeenCalledTimes(1);

    source.fire(250); // two ticks worth of delta
    expect(onTick).toHaveBeenCalledTimes(2);
    expect(onFrame).toHaveBeenCalledTimes(2);
  });

  it('requests the next frame again after a normal tick', () => {
    const source = makeFakeFrameSource();
    startTickLoop({
      tickMs: TICK_MS,
      onTick: () => {},
      onFrame: () => {},
      requestFrame: source.requestFrame,
      cancelFrame: source.cancelFrame,
    });

    source.fire(0);
    expect(source.pending()).toBe(1);
  });

  it('stop() prevents any further onTick/onFrame calls', () => {
    const source = makeFakeFrameSource();
    const onTick = vi.fn();
    const onFrame = vi.fn();

    const stop = startTickLoop({
      tickMs: TICK_MS,
      onTick,
      onFrame,
      requestFrame: source.requestFrame,
      cancelFrame: source.cancelFrame,
    });

    source.fire(0);
    stop();
    // A frame callback that was already queued firing after stop() must
    // be a no-op.
    source.fire(1000);

    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onTick).not.toHaveBeenCalled();
  });

  it('guards an exception thrown from onTick: logs it and demonstrably terminates the loop instead of freezing silently', () => {
    const source = makeFakeFrameSource();
    const onError = vi.fn();
    const onFrame = vi.fn();
    let calls = 0;

    startTickLoop({
      tickMs: TICK_MS,
      onTick: () => {
        calls += 1;
        throw new Error('No empty cell available for food placement');
      },
      onFrame,
      onError,
      requestFrame: source.requestFrame,
      cancelFrame: source.cancelFrame,
    });

    source.fire(0);
    source.fire(TICK_MS); // one tick due; onTick throws

    expect(calls).toBe(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    // The frame is still rendered once (last good state), but no further
    // frame is requested: the loop is demonstrably stopped, not silently
    // spinning or silently frozen mid-callback.
    expect(onFrame).toHaveBeenCalledTimes(2);
    expect(source.pending()).toBe(0);

    // Firing whatever might still be pending (there is nothing) must not
    // resurrect ticking.
    source.fire(TICK_MS * 5);
    expect(calls).toBe(1);
  });

  it('logs to console.error by default when no onError is supplied', () => {
    const source = makeFakeFrameSource();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    startTickLoop({
      tickMs: TICK_MS,
      onTick: () => {
        throw new Error('boom');
      },
      onFrame: () => {},
      requestFrame: source.requestFrame,
      cancelFrame: source.cancelFrame,
    });

    source.fire(0);
    source.fire(TICK_MS);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });
});
