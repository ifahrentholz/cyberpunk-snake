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
 */
describe('logic suite runtime environment (issue #13)', () => {
  it('runs with no DOM present: window, document and localStorage are all undefined', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
    expect(typeof localStorage).toBe('undefined');
  });
});
