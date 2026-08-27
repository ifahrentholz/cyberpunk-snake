# cyberpunk-snake

A neon-noir Snake game for the browser. Vanilla TypeScript, Vite, Canvas 2D
— no runtime dependencies.

## Play

```
npm install
npm run dev
```

Developed and tested on Node 24. Open the URL Vite prints. Press an
arrow key or `WASD` to start.

Play it live: _will be added with #9 (GitHub Pages deployment)._

### Controls

| Key                   | Action                   |
| ---------------------- | ------------------------- |
| Arrow keys or `WASD`   | Move                      |
| `Space`                | Pause / resume (toggle)  |
| `R`                    | Restart                  |

The snake doesn't move on its own — the game starts on your first
direction key press. Keys held with `Ctrl`/`Cmd`/`Alt` are ignored, so
browser shortcuts (e.g. Cmd+R) keep working; `Shift` is not affected.

## Develop

```
npm test        # vitest run
npm run typecheck  # tsc --noEmit
npm run lint     # eslint .
npm run build    # vite build
```

183 tests across 11 files, all green, no runtime `dependencies` in
`package.json`.

### Project structure

```
src/logic/         pure game rules — no DOM, no randomness, no clock
src/input/         keyboard events -> game actions
src/renderer/       game state -> canvas (read-only)
src/persistence/    highscore <-> localStorage (storage is injected)
src/composition/    the tick loop (fixed-rate, time-accumulating)
src/main.ts         the composition boundary — selects and injects the
                     clock, randomness and the concrete browser Window;
                     time and randomness enter the program only here
src/test-support/   a fake canvas context shared by renderer tests
```

The DOM itself isn't confined to `main.ts`, though: `renderer` owns the
canvas (sizing, drawing context) and `persistence`'s default storage
implementation owns `localStorage` — each layer holds a narrow, named
slice of the platform rather than routing every access through the
composition boundary. `src/logic` is the one layer where purity is
mechanically enforced, not just conventional: it may not import anything
else under `src/`, nor touch the DOM, `Math.random`, or the clock, all
via the `eslint.config.js` allow-list. Randomness, time and storage are
passed into it as parameters instead. See `docs/adr/` (ADR-0001 and
ADR-0008 in particular) for why.

### Tests

- Default test environment is `node`. A test that genuinely needs a DOM
  opts in with a docblock pragma as the very first line of the file — not
  merely near the top:

  ```
  // @vitest-environment jsdom
  ```

  Three files opt in today: `src/main.test.ts`,
  `src/input/keyboard.integration.test.ts`, and
  `src/renderer/canvas.integration.test.ts`.
- Convention, not just caution: don't write that token into a comment for
  any other reason. Vitest scans the whole file for `@vitest-environment`
  followed by an environment name, and a negation in front of it does not
  protect — that pattern is what turned a `(no @vitest-environment jsdom
  pragma)` docblock in #7 into jsdom anyway. The one deliberate exception
  is `tests/logic-environment.test.ts`, which mentions the token with no
  name after it (so it doesn't match) and asserts `typeof window ===
  'undefined'` to guard itself regardless — hence four files mention the
  token, but only three actually opt in.
- Test layout: unit tests live next to their code (`src/**/*.test.ts`);
  cross-cutting tests (e.g. the import-boundary suite) live under
  `tests/**`. Both globs are configured in `vitest.config.ts`. A test file
  outside both globs simply doesn't run — no error, no warning, exit 0.
  See ADR-0005.

### Architecture decisions

Design rationale lives in `docs/adr/` (ADR-0001 through ADR-0008), and
per-ticket changes in `docs/release-notes/CHANGELOG.md`. This README
covers what exists and how to use it; the ADRs cover why.
