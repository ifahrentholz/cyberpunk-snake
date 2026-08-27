/**
 * Persistence layer (issue #7) — encapsulates highscore read/write
 * against a narrow storage interface, backed by real `localStorage` by
 * default. Deliberately independent of the other layers: only
 * `src/main.ts` (the composition layer) imports this module, reading the
 * highscore at startup, handing it to the renderer to draw, and writing
 * it back when a just-finished game genuinely beats it. Nothing in
 * `src/logic` or `src/renderer` imports this module — that boundary is
 * a convention this project relies on (not mechanically enforced by
 * `eslint.config.js`'s import zone, which today only restricts
 * `src/logic`), see issue #7's ticket brief.
 *
 * `localStorage` is injected, not read directly — the same convention as
 * the `rng` in `src/logic` (decision D11) and `FrameSource` in
 * `src/main.ts`: every exported function here takes a `HighscoreStorage`
 * parameter defaulting to `browserLocalStorage`, so this module's own
 * tests exercise it entirely against an in-memory replacement, no DOM
 * required (issue #7 AC7).
 */

/** The `localStorage` key the highscore is stored under. */
const HIGHSCORE_KEY = 'cyberpunk-snake:highscore';

/** The narrow storage surface this module needs — satisfied by `localStorage`. */
export interface HighscoreStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The real browser `localStorage`, wrapped as a `HighscoreStorage`
 * rather than referenced as a bare global throughout this file. The
 * wrapped methods close over the `localStorage` global but do not
 * evaluate it until actually called, so importing this module — or
 * constructing this constant — never touches `localStorage` in an
 * environment that lacks it; this module's own tests always inject a
 * fake storage instead and never fall through to this default.
 */
export const browserLocalStorage: HighscoreStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
};

/**
 * Reads the stored highscore. A missing key, a non-numeric value
 * (`Number(...)`, not `parseInt` — `parseInt('12abc')` would silently
 * accept the numeric prefix and return 12, which is garbage
 * half-accepted, not garbage rejected), a negative value, `NaN` or
 * `Infinity` are all treated as "no highscore yet" (issue #7 AC: "a
 * missing/non-numeric/negative stored value is treated as 0").
 *
 * A throwing `getItem` (issue #7 AC — e.g. Safari private-mode browsing
 * has historically thrown here, or a blocking browser extension) is
 * caught and treated the same as "no highscore yet" rather than
 * propagating and making the game unplayable.
 */
export function readHighscore(storage: HighscoreStorage = browserLocalStorage): number {
  let raw: string | null;
  try {
    raw = storage.getItem(HIGHSCORE_KEY);
  } catch {
    return 0;
  }
  if (raw === null) {
    return 0;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

/**
 * Records `candidate` as the new highscore only if it genuinely improves
 * on the currently stored value — strictly greater; a tie is not an
 * improvement (issue #7 AC). Returns the highscore that applies after
 * this call (the new value if it was written, the previous one
 * otherwise), so a caller never has to re-read storage to know what to
 * show next.
 *
 * A throwing `setItem` (same real-world causes as `readHighscore`'s
 * throwing `getItem` — this is the AC's "worst moment" case, since it
 * fires right at game end) is caught: the candidate simply isn't
 * persisted, but this function still returns a usable highscore and the
 * game keeps running.
 */
export function recordHighscore(candidate: number, storage: HighscoreStorage = browserLocalStorage): number {
  const current = readHighscore(storage);
  if (candidate <= current) {
    return current;
  }
  try {
    storage.setItem(HIGHSCORE_KEY, String(candidate));
  } catch {
    return current;
  }
  return candidate;
}
