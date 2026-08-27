import { describe, expect, it } from 'vitest';

/**
 * Runtime counterpart to `import-boundary.test.ts` (issue #13). That suite
 * enforces DOM purity *statically*: it lints representative `src/logic`
 * source text and fails if it *references* `window`/`document`. It cannot
 * see whether the test runner itself hands `src/logic`'s own suite a real
 * DOM to lean on regardless of what the source text says — that gap is
 * exactly what let `vitest.config.ts` default every suite to `jsdom` for
 * two tickets without anything failing.
 *
 * This file has no `// @vitest-environment` pragma, so — like
 * `src/logic/game.test.ts` and `tests/import-boundary.test.ts` — it
 * inherits whatever `vitest.config.ts` sets as the project-wide default.
 * The assertions below observe that default directly: if it ever regresses
 * back to `jsdom` (or this file grows a stray pragma), `window`, `document`
 * and `localStorage` become defined and this test goes red. A file that
 * legitimately needs a DOM opts in explicitly per the convention documented
 * in `vitest.config.ts` (worked example: `src/input/keyboard.integration.test.ts`)
 * — it does not touch this default.
 *
 * SCOPE OF WHAT THIS TRACKS (raised in #13 review): this sensor observes
 * the single GLOBAL default, because today a single flat default is all
 * there is. If a future ticket introduces per-directory environment
 * scoping (Vitest's `environmentMatchGlobs`), this file could end up
 * matched by whatever glob covers `tests/**` while `src/logic/**` — the
 * thing this sensor actually exists to guard — is matched by a different
 * glob, and the two would silently decouple without this test failing.
 * Whoever introduces per-directory scoping must either relocate this
 * sensor into `src/logic/` or add an equivalent one there.
 *
 * WHY THIS SENSOR IS MECHANISM-AGNOSTIC, NOT JUST A CONFIG-VALUE CHECK
 * (also from #13 review, worth recording rather than re-deriving): the
 * assertions below observe the actual runtime state (`typeof window`,
 * `typeof document`, `typeof localStorage`) instead of reading the
 * `environment` field out of the resolved config. That was verified to
 * matter, not just be tidier: this test was confirmed to go red not only
 * when the global default is flipped back to `jsdom`, but also under a
 * `setupFiles` hook that assigns `globalThis.window`, and under a CLI
 * `--environment=jsdom` override — and it would equally catch a future
 * `environmentMatchGlobs` misconfiguration that hands this file a DOM.
 * None of those regression routes require touching the `environment: '...'`
 * string this test happens to sit near, which is exactly the point.
 */
describe('logic suite runtime environment (issue #13)', () => {
  it('runs with no DOM present: window, document and localStorage are all undefined', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
    expect(typeof localStorage).toBe('undefined');
  });
});
