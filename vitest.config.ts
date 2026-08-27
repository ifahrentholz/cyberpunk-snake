import { defineConfig } from 'vitest/config';

// Default test environment is `node`, not `jsdom` (see #13). The pure logic
// layer's suite (`src/logic/**`, `tests/**`) has no legitimate reason to
// touch `window`, `document` or `localStorage`, and running it without a DOM
// makes that a runtime guarantee instead of an accident of configuration.
//
// A test file that genuinely needs a DOM (canvas rendering in #6,
// `localStorage` highscore persistence in #7, or any other real browser API)
// opts in per file with a docblock pragma as the FIRST line of the file:
//
//   // @vitest-environment jsdom
//
// See `src/input/keyboard.integration.test.ts` for the worked example: it
// dispatches a real `keydown` event against `document` and needs the pragma
// to get a DOM; every other test file in this repo does not.
//
// CAVEAT (raised in #13 review): the ESLint DOM/purity allow-list in
// `eslint.config.js` is scoped to `files: ['src/logic/**/*.{ts,mts,cts}']`
// only. It does not reach `tests/**` at all. So while a jsdom pragma plus a
// `window` reference inside `src/logic` is caught (both by that allow-list
// and, at runtime, by `tests/logic-environment.test.ts`), the same pragma
// plus the same reference inside a file under `tests/**` — including
// `tests/import-boundary.test.ts` and the guard itself — is not flagged by
// ESLint at all. That is a deliberate, two-step act by a contributor, not a
// silent regression, and this project does not enumerate defences against
// deliberate acts (see ADR-0001). Naming it here so nobody over-trusts the
// pairing of "ESLint allow-list catches usage, runtime guard catches
// environment" as covering every file in the repo — it only covers
// `src/logic/**`.
export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts', 'src/**/*.test.ts'] },
});
