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
export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts', 'src/**/*.test.ts'] },
});
