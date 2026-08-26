# Release Notes

Format loosely follows [Keep a Changelog](https://keepachangelog.com/).
Entries are grouped under `## Unreleased` until a version is cut; each
ticket appends one entry here, referencing its issue number. See
`docs/adr/` for the reasoning behind a change; this file is for what
changed and, where relevant, why it matters to someone running or
contributing to the project — not the reasoning itself.

## Unreleased

### Added

- Project scaffold: Vite, strict TypeScript, Vitest, ESLint (#2). No
  user-visible behaviour ships with this ticket — there is no game yet.
  This lays the toolchain and the architectural guard rails (see
  `docs/adr/0001-toolchain-and-logic-purity-boundary.md`) that every
  later ticket builds on.
- Four canonical commands, now the contract every later ticket must keep
  green: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
- Core game reducer (#3): `createGame`/`step` implement the full snake
  mechanics — movement, direction queuing with the 180°-reversal guard,
  wall and self-collision, pause/resume, restart — as a pure, fully
  tested state machine (54 tests total: 23 in `game.test.ts`, 1 in
  `main.test.ts`, 30 in `tests/import-boundary.test.ts`). **Nothing is
  playable yet**: there is no renderer and no tick loop driving this
  reducer, so there is still no game to look at or play until #6 lands.
  See `docs/adr/0002-core-reducer-contract.md` for the reasoning,
  including a pause-buffering bug (AC11) found and fixed during review
  and the `initialSnakeLength` config addition needed to make
  self-collision (AC8) reachable through the public API at all.
- Keyboard input binding (#5): `keyToAction` (pure key+status → action
  mapper) and `bindKeyboard` (the `keydown` DOM seam) exist and are fully
  tested — 34 unit tests against a fake event target plus 1 integration
  test against a real `keydown` dispatch on `document`. **This ticket
  produces no playable change.** The keyboard layer exists but nothing
  drives it yet: there is still no tick loop and no renderer, so a player
  sees nothing new until #6 lands and wires this layer up. Once it is
  wired: arrow keys and WASD steer the snake, Space pauses and resumes,
  `R` restarts, holding a key down does not cause a pause flicker (OS
  key-repeat is ignored), and browser/OS shortcuts that share a key —
  Cmd/Ctrl+R, Ctrl+A, Cmd/Ctrl+W, Cmd+S — keep working normally instead of
  being swallowed. See `docs/adr/0003-keyboard-input-binding.md` for the
  reasoning behind the pause/resume toggle placement and the two input
  guards.
- Food placement, growth and scoring (#4): the reducer now eats, grows and
  scores. `pickFoodPosition` (enumeration-based, not rejection sampling, so
  it terminates even on a nearly-full grid) is reused from #3 and now also
  runs mid-tick, after a food check inserted into the existing collision
  sequence: a head landing on food grows the snake by one segment, adds one
  to `score`, and immediately respawns food onto a free cell that avoids
  the grown snake entirely. A non-eating tick behaves exactly as it did
  under #3. **Breaking API change**: the `tick` action now requires an
  `rng: Rng` field (`{ type: 'tick', rng }`), and `step`'s `action`
  parameter is no longer optional — the previous `action ?? { type: 'tick'
  }` default is gone, so any code still calling `step(state)` or
  `step(state, { type: 'tick' })` needs updating. `rng` is drawn exactly
  once per eating tick and never otherwise (verified with a call-counting
  wrapper). Also worth knowing: on a completely full grid, food placement
  throws rather than declaring a win — there is no win condition in the
  spec and none was added; on the standard 28×28 grid this needs 784
  snake segments, and handling the throw at the tick-loop level is
  explicitly carried by #6, not this ticket. **Still nothing playable.**
  All of this lives in the pure logic layer only; there is still no tick
  loop and no renderer driving it, so a player sees nothing new until #6
  wires movement, input and food together on screen. See
  `docs/adr/0004-food-placement-growth-and-scoring.md` for the mandatory-
  `rng` decision, the fixed collision-then-growth tick order and the
  tail/food edge case it creates, and a test-strength finding: two
  occupied-cell tests stayed green with the occupied-cell filter disabled
  entirely, and had to be rewritten around a grid with exactly one legal
  free cell to actually catch that mutation.
- Scoped the Vitest test environment (#13): the default is now `node`
  instead of `jsdom` for every suite. A test file that genuinely needs a DOM
  opts in per file with a `// @vitest-environment jsdom` pragma (see
  `src/input/keyboard.integration.test.ts`); #6 and #7 will need the same
  opt-in for canvas and `localStorage` work. No player-visible change:
  previously the logic layer's own tests ran with a DOM present by accident
  of configuration and nothing would have failed if they'd come to depend on
  it; a new runtime guard (`tests/logic-environment.test.ts`, one more test,
  102 total) now fails if that ever regresses. Side effect: the suite is
  measurably faster (roughly 1.2s to 1.0s). See
  `docs/adr/0005-scoped-test-environment.md`.
