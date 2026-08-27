/**
 * Persistence layer unit tests (issue #7). No DOM needed: every test
 * injects an in-memory `HighscoreStorage` replacement instead of the
 * real `localStorage`, so this file carries none of Vitest's per-file
 * environment opt-in comments and runs under the default `node`
 * environment (see #13).
 *
 * Deliberately not spelling out that opt-in comment's exact syntax
 * anywhere in this file, even to say "not present": Vitest's own pragma
 * scanner matches across the *whole file*, not just a leading block
 * comment, so a literal mention — negated or not — would flip this file
 * onto jsdom despite this docblock saying the opposite (found in #7's
 * Stage 5 review; confirmed empirically, not just by inspection). Under
 * jsdom, `localStorage` genuinely exists, so a test that accidentally
 * fell through to `recordHighscore`'s/`readHighscore`'s default storage
 * instead of the injected fake below would pass silently here instead
 * of throwing — exactly the failure class this suite exists to catch.
 * The first test below pins the environment directly so that class of
 * mistake cannot return unnoticed.
 */
import { describe, expect, it } from 'vitest';
import { readHighscore, recordHighscore, type HighscoreStorage } from './index';

describe('this file runs without a DOM', () => {
  it('has no `window` global (confirms the `node` vitest environment applies, not jsdom)', () => {
    expect(typeof window).toBe('undefined');
  });
});

/** A minimal in-memory stand-in for `localStorage`. */
function makeMemoryStorage(initial: Record<string, string> = {}): HighscoreStorage & { readonly data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (key: string) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key]! : null),
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

function makeThrowingGetItem(): HighscoreStorage {
  return {
    getItem: () => {
      throw new Error('getItem is blocked (e.g. Safari private mode)');
    },
    setItem: () => {
      // unused in these cases
    },
  };
}

function makeThrowingSetItem(initial: Record<string, string> = {}): HighscoreStorage {
  const data: Record<string, string> = { ...initial };
  return {
    getItem: (key: string) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key]! : null),
    setItem: () => {
      throw new Error('setItem is blocked (e.g. Safari private mode quota)');
    },
  };
}

describe('readHighscore', () => {
  it('treats a missing stored value as 0', () => {
    const storage = makeMemoryStorage();
    expect(readHighscore(storage)).toBe(0);
  });

  it('returns the stored number when it is a valid non-negative number', () => {
    const storage = makeMemoryStorage({ 'cyberpunk-snake:highscore': '42' });
    expect(readHighscore(storage)).toBe(42);
  });

  it.each(['abc', '12abc', 'NaN', 'Infinity', '-Infinity', '', ' '])(
    'treats a non-numeric stored value %j as 0',
    (garbage) => {
      const storage = makeMemoryStorage({ 'cyberpunk-snake:highscore': garbage });
      expect(readHighscore(storage)).toBe(0);
    },
  );

  it('treats a negative stored value as 0', () => {
    const storage = makeMemoryStorage({ 'cyberpunk-snake:highscore': '-5' });
    expect(readHighscore(storage)).toBe(0);
  });

  it('treats a throwing getItem as 0 rather than propagating', () => {
    const storage = makeThrowingGetItem();
    expect(() => readHighscore(storage)).not.toThrow();
    expect(readHighscore(storage)).toBe(0);
  });
});

describe('recordHighscore', () => {
  it('writes and returns the candidate when it genuinely improves on the stored value', () => {
    const storage = makeMemoryStorage({ 'cyberpunk-snake:highscore': '3' });
    expect(recordHighscore(7, storage)).toBe(7);
    expect(storage.data['cyberpunk-snake:highscore']).toBe('7');
  });

  it('does not write when the candidate merely ties the stored value', () => {
    const storage = makeMemoryStorage({ 'cyberpunk-snake:highscore': '5' });
    expect(recordHighscore(5, storage)).toBe(5);
    expect(storage.data['cyberpunk-snake:highscore']).toBe('5');
  });

  it('does not write when the candidate is lower than the stored value', () => {
    const storage = makeMemoryStorage({ 'cyberpunk-snake:highscore': '9' });
    expect(recordHighscore(2, storage)).toBe(9);
    expect(storage.data['cyberpunk-snake:highscore']).toBe('9');
  });

  it('writes a first score against a missing stored value (treated as 0)', () => {
    const storage = makeMemoryStorage();
    expect(recordHighscore(1, storage)).toBe(1);
    expect(storage.data['cyberpunk-snake:highscore']).toBe('1');
  });

  it('does not write a non-improving score of 0 against a missing stored value', () => {
    const storage = makeMemoryStorage();
    expect(recordHighscore(0, storage)).toBe(0);
    expect(storage.data['cyberpunk-snake:highscore']).toBeUndefined();
  });

  it('treats a throwing setItem as "did not persist" without throwing itself, and still returns the previous highscore', () => {
    const storage = makeThrowingSetItem({ 'cyberpunk-snake:highscore': '4' });
    expect(() => recordHighscore(10, storage)).not.toThrow();
    expect(recordHighscore(10, storage)).toBe(4);
  });
});
