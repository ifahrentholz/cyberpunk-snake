# 0008. Highscore persistence: storage as a third injected boundary, and a guard-removal probe that caught its own test's shortcut

Date: 2026-08-27
Status: Accepted

## Context

Issue #7 adds highscore persistence: `src/persistence/index.ts`
(`readHighscore` / `recordHighscore` against a narrow `HighscoreStorage`
interface), wired into `src/main.ts` so the highscore is read once at
startup, shown in the HUD and on the game-over overlay
(`src/renderer/canvas.ts`), and written back exactly when a finished game
genuinely beats it. 183 tests pass across 11 files (`npm test`, verified
live on this branch), plus `npm run typecheck` / `lint` / `build`.

This ADR is not an implementation walkthrough — the read/reject rules for
a stored value are read directly from `readHighscore`'s own doc comment.
It records: the injection decision and why it is the third instance of a
pattern this project already has twice, a property of the module's
`localStorage` wrapper that is not just style, two small rule choices
that are easy to silently reverse, a return-type change forced by a
staleness bug, an API-shape change forced by a same-type-parameter
transposition hazard, a test-strength lesson that repeated within a
single Stage-6 follow-up round, and a self-inflicted test-environment bug
that revises a limitation ADR-0005 recorded as accepted.

## Decision

### 1. Storage is injected, not reached for — the third instance of this project's one convention

`HighscoreStorage { getItem, setItem }` is a two-method interface;
`readHighscore` and `recordHighscore` both take a `storage` parameter
defaulting to `browserLocalStorage`. Nothing in `src/logic` or
`src/renderer` imports `src/persistence` — only `src/main.ts` does — and
nothing in `src/persistence` reaches for the bare `localStorage` global
except inside `browserLocalStorage` itself.

This is the same convention this project already applied twice: `rng` on
the logic layer's `tick` action (ADR-0004, a decision the human made —
mandatory, not optional, specifically so a missing `rng` fails closed at
compile time) and `FrameSource` in `src/main.ts` (ADR-0006, injected so
`startTickLoop` could be driven deterministically through a fake frame
source in tests). Recording the cross-reference is the point: three
independent tickets converging on the same shape is a pattern worth a
future contributor recognising on sight, not three unrelated local
choices that happen to look similar. The concrete payoff here matches the
other two: `src/persistence/index.test.ts` runs entirely against an
in-memory `HighscoreStorage` fake and needs no `jsdom` (issue #7's AC7),
the same way `FrameSource` injection let #6's error-banner path be tested
without real elapsed time.

### 2. `browserLocalStorage`'s methods defer evaluating `localStorage` until called, not at module import

```ts
export const browserLocalStorage: HighscoreStorage = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
};
```

The two closures reference `localStorage` inside their bodies, not at the
point the `browserLocalStorage` object literal is constructed. That is
not stylistic — it is the reason this module is importable at all under
the `node` Vitest environment that ADR-0005 made the project default:
`src/persistence/index.test.ts` runs under `node` (no global `localStorage`)
and imports `browserLocalStorage` from the same module under test, and
none of its 18 tests throw on import. If `browserLocalStorage` had
instead been built as `{ getItem: localStorage.getItem.bind(localStorage), ... }`
or any other form that touches the `localStorage` global while the
module itself is being evaluated, importing this file under `node` would
throw immediately, before a single test ran. The property proves itself
by the file's own tests passing, rather than needing a dedicated
assertion.

### 3. `Number(raw)`, not `parseInt(raw, 10)`

Quoted from the code because it is already the precise reasoning:
`parseInt('12abc')` would silently accept the numeric prefix and return
`12` — garbage half-accepted, not garbage rejected. `Number('12abc')` is
`NaN` instead, which the existing `!Number.isFinite(value)` check already
routes to "no highscore yet." The same `Number.isFinite` check, plus the
adjacent `value < 0` check, is what lets a single branch also swallow a
stored `Infinity`/`-Infinity` and a negative value without a separate
case for each — all verified together by
`it.each(['abc', '12abc', 'NaN', 'Infinity', '-Infinity', '', ' '])` (the
non-numeric cases) plus a dedicated negative-value test in
`src/persistence/index.test.ts`. Missing, non-numeric, negative, `NaN`
and `Infinity` are all folded into the same "treat as 0" branch (issue #7
AC4/AC5), deliberately not distinguished from each other in the return
value — a caller has no way to tell "never played" from "storage was
corrupted," and nothing in the spec asks it to.

### 4. A tie is not an improvement

`recordHighscore` writes only when `candidate > current`, strictly. A
replay that matches the existing highscore exactly does not trigger a
write. This is a one-line decision, not a bug worth a paragraph, but it
is exactly the kind of thing a future refactor could silently flip to
`>=` without any test failing loudly unless the test suite specifically
pins the tie case — which it does
(`does not write when the candidate merely ties the stored value`,
`src/persistence/index.test.ts`).

### 5. `AppComposition.highscore: number` became `getHighscore: () => number`

The original field was a value captured once, at `composeApp` time. It
would have gone stale the moment the first game ended with a genuine
improvement — a silent bug that would not surface until a second game
was played and the HUD kept showing the pre-game-one number. It is now a
live read, `getHighscore: () => number`, the same shape as the existing
`getState: () => GameState` on the same interface — not a new pattern on
this composition object, an existing one applied to a second field that
needed it.

### 6. `render()` takes a `RenderOptions` object, not a fifth positional parameter

`cellSize`, `timestampMs` (added by #16) and `highscore` (added here) are
all plain `number`. Adding `highscore` as a fifth positional parameter
would have compiled cleanly at every call site regardless of argument
order — TypeScript's structural typing does not distinguish same-typed
positional parameters from each other. `render()`'s signature changed to
`render(ctx, { state, cellSize, timestampMs, highscore }: RenderOptions)`
instead, which turns a transposition between any two of those three
numbers from a silent, compiling bug into a named-property mismatch the
compiler would actually have something to say about. This is a
concrete defect class the change closes, not a general preference for
options objects over parameters.

### 7. The lesson beyond this ticket: a composition-level pin for AC6, and a test whose first draft proved nothing

Non-blocking Stage-6 review found that AC6 ("a throwing storage access
must not make the game unplayable") was pinned only at the
`src/persistence` unit level. Nothing drove `composeApp` with a throwing
`HighscoreStorage` through a real game to confirm the composition layer
actually swallows the failure end to end — that #6's `startTickLoop`
freeze guard doesn't misfire on it, that the error banner stays hidden,
that the loop keeps running afterwards. This is literally the shape
ADR-0004 named first: a load-bearing property verified once, ad hoc, and
then left with nothing in the repo pinning it. A composition test was
added (`src/main.test.ts`, "issue #7 AC6: a storage that throws on
getItem AND setItem does not make the game unplayable"), driven through
the real `startTickLoop` via the injected `FrameSource` — not through
`advanceTick()` directly, because only the frame-loop path exercises the
`onTick` try/catch that would surface the #6 error banner if the failure
weren't actually being swallowed.

The sharper finding: **the first draft of that test was itself a false
guarantee.** It left `Math.random` unmocked. With a throwing `getItem`,
`readHighscore` always reports a current highscore of `0`; that run's
real, unmocked food placement happened to also score `0`, so
`recordHighscore`'s `candidate <= current` short-circuited before ever
reaching `storage.setItem` — the guard the test exists to prove was never
exercised, and the test stayed green regardless. This was found by the
implementing agent itself, while running the guard-removal probe alfred
requested (below) — not by review, and not by inspection. It was fixed by
pinning `Math.random` (the same value used elsewhere in the file for a
"persists a new highscore" test) to force a genuine, non-zero
improvement, with `expect(app.getState().status).toBe('over')` retained
as the assertion that proves the scripted run actually reached the state
the rest of the test's assertions depend on.

Stated as the reusable rule: **a test for an error path must prove it
reaches the error path.** A test that means to exercise exception
handling but silently short-circuits on an unrelated condition first is
green and worthless — passing for a reason that has nothing to do with
what it claims to check. This is the second time in this project's
history (after the algebraic tautology found in ADR-0007, point 4) that
a mutation-style probe caught a self-inflicted false guarantee in a test
written in the same round that added it, rather than in an older test
found by a dedicated review pass.

**Verification, run independently in a separate `git worktree`, not
merely re-narrated from the implementing agent's report:**
- Removing the `try`/`catch` around `storage.setItem` in
  `recordHighscore` → exactly 2 tests red: the existing
  `src/persistence/index.test.ts` unit case, and the new composition
  test (fails on `expect(banner?.hidden).toBe(true)` — the throw
  propagates through `dispatch` → `onTick` → `startTickLoop`'s catch →
  `onError`, precisely the misfire this test exists to rule out).
- Removing the `try`/`catch` around `storage.getItem` in `readHighscore`
  → exactly 2 tests red: the same two files, this time failing at
  `composeApp`'s startup read, before a game is even played.
- `src/persistence/index.ts` restored byte-identical after each removal
  (md5 `5f17d334d678078f9d65299ee9bef3d7` before and after both).

## Known limitations — stated honestly, not smoothed over

1. **AC1 ("shown in HUD/game-over screen") and AC2 ("survives a reload")
   are verified only by reading the code, not by any test.** Neither can
   be mechanically tested in this project: AC16 (ADR-0007) forbids any
   test that asserts on canvas output, so nothing can check that
   `Highscore: N` actually appears on screen; a reload does not exist
   without a real browser, which nobody in this pipeline has run this
   game in yet (a limitation carried forward from #6 and #16). This needs
   an actual human look before it is treated as settled — the same open
   item ADR-0006 and ADR-0007 already carry, still open here.
2. **AC8 ("narrow interface, not accessed ad hoc") is a convention, not
   a mechanically enforced one.** `eslint.config.js`'s
   `import/no-restricted-paths` zone only restricts what `src/logic`
   itself may import — it says nothing about `src/renderer` or
   `src/input` importing `src/persistence`. Today `src/main.ts` is the
   only importer (`grep -rln "from '.*persistence'" src` returns only
   `src/main.ts` and `src/main.test.ts`), but nothing would stop that
   from changing silently. This is the same reach limit ADR-0005 already
   named for a different guard (the ESLint allow-list only reaching
   `src/logic/**`) — named here as a convention to honour, not
   over-claimed as an enforced one.
3. **A repo-wide runtime canary against future environment
   misconfiguration was considered and deliberately not built.** Fixing
   the pragma bug below raised the question of whether the #13 guard
   (`tests/logic-environment.test.ts`) should be generalised into a
   scanner that checks every `.test.ts` file for a stray environment
   opt-in. Rejected: the failure class here was not "the wrong
   environment is configured," it is "a comment happens to contain a
   string Vitest's scanner treats as meaningful" — a scanner for that is
   the enumerate-forever trap ADR-0001 already argues against (a list of
   phrasings someone thought of, not a structural property). The project
   now has two independently-arrived-at instances of the same narrow,
   local pattern instead: `tests/logic-environment.test.ts` (#13) and the
   new first test in `src/persistence/index.test.ts` (below), each a
   direct runtime assertion scoped to the one file it protects. Modest,
   mechanical, and justifiable per file — the shape ADR-0001 prefers over
   a general-purpose scanner.

## A second, independent finding: a docblock that said "no pragma" was itself a pragma

`src/persistence/index.test.ts`'s original docblock explained, in prose,
that the file carried no `@vitest-environment jsdom` opt-in. It did so by
spelling out that exact string. Vitest's own pragma scanner matches the
literal token `@vitest-environment <name>` anywhere it appears in a file
— it does not parse surrounding English, so a negated mention ("no ...
pragma") is indistinguishable to it from a genuine opt-in. The file was
silently running under `jsdom`, not the `node` environment its own
comment claimed.

This is not cosmetic. The entire point of injecting `HighscoreStorage` is
that `src/persistence` is testable without a DOM (AC7). Under `jsdom`,
`localStorage` genuinely exists as a global; a test that accidentally
fell through to a default parameter instead of the injected in-memory
fake would have passed silently under `jsdom` instead of throwing —
exactly the failure class this suite exists to rule out.

Fixing it surfaced a fact sharper than the bug itself: **Vitest's scanner
reads the whole file, not just a leading block comment** — a mention
lower down the file flips the environment just the same, confirmed
empirically with throwaway probe files, not assumed from documentation.
The only rule that is actually safe, then, is not "put the pragma
correctly at the top" but **do not write the literal token
`@vitest-environment <name>` anywhere in a `.test.ts` file unless that
file genuinely means to opt in** — not in a comment, not negated, not
below the imports. The fix reworded the docblock to describe the opt-in
mechanism without spelling out its syntax, and added a permanent first
test, `typeof window === 'undefined'`, pinning the environment directly
so this exact mistake cannot silently recur. Stage 5 confirmed the pin is
live: injecting a real `// @vitest-environment jsdom` pragma turns
exactly 1 of the file's 18 tests red — that pin, and only that pin.

**This revises a limitation ADR-0005 recorded, rather than restating
it.** ADR-0005's known limitations state: "A stray pragma on a logic test
file is not detected... that requires a deliberate, two-step act by a
contributor, not a silent regression." This ticket's finding is a
counter-example to the "deliberate act" framing: the pragma here was
introduced by a comment written specifically to describe its *absence*,
by a contributor with no intent to opt into `jsdom` at all. The
underlying limitation ADR-0005 named — a stray environment opt-in is not
mechanically caught outside `src/logic` — still stands and is not
corrected here; what's revised is the belief that it can only happen
deliberately. ADR-0005 itself is left unedited, per this ticket's scope;
this paragraph is the pointer for whoever next reads it.

## Consequences

- `src/persistence` is the third module in this project built around an
  injected boundary rather than a directly-referenced global (`rng`,
  `FrameSource`, now `HighscoreStorage`) — a future ticket reaching for a
  new browser API (geolocation, IndexedDB, whatever comes next) should
  recognise this as the project's default shape for that kind of
  dependency, not decide fresh each time.
- `browserLocalStorage`'s deferred-evaluation property is load-bearing
  for `src/persistence/index.test.ts` running under `node`; anyone
  rewriting `browserLocalStorage` should keep the `localStorage`
  reference inside the method bodies, not hoist it to module scope.
- AC6 is now pinned at two levels — unit (`src/persistence/index.test.ts`)
  and composition (`src/main.test.ts`) — and the guard-removal probe
  above shows both actually fail if either `try`/`catch` in
  `src/persistence/index.ts` is removed.
- The rule from point 7 — a test for an error path must prove it reaches
  the error path — is now a second, independently-found data point (after
  ADR-0007's tautology) for reviewers and implementing agents alike to
  recognise the shape of, rather than needing to rediscover it from
  scratch a third time.
- The literal string `@vitest-environment <name>` must not appear in a
  `.test.ts` file's text unless that file genuinely opts into that
  environment — not even negated, not even below the imports. This is
  now demonstrated by `src/persistence/index.test.ts`'s own pinned first
  test, the template for closing the same mistake if it recurs elsewhere.
- AC1 and AC2 remain verified only by code reading, and AC8 remains a
  named convention rather than a mechanically enforced one — both stay
  open until a human looks at this in a real browser, the same
  outstanding item #6 and #16 already left behind.
