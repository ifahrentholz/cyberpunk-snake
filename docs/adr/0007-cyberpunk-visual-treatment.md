# 0007. Cyberpunk visual treatment: shadow-state leaks, the pinned-condition lesson, and a test-double gap that shaped a rendering choice

Date: 2026-08-27
Status: Accepted

## Context

Issue #16 applies the approved cyberpunk design-token palette
(https://github.com/ifahrentholz/cyberpunk-snake/issues/1, spec approved
2026-08-25) over the playable slice #6 already shipped: a single
`COLORS` design-token object, neon glow via `shadowBlur`/`shadowColor` on
the grid and snake, a dimmed background grid, a pulsing food, a static
scanline overlay, and a head visually distinct from the body. Everything
lives in `src/renderer/canvas.ts`; the only other production change is
one line in `src/main.ts` threading a frame timestamp through to
`render()`. 162 tests across 10 files pass (`npm test`, verified live on
this branch), plus `npm run typecheck` / `lint` / `build`.

This ADR is not an implementation walkthrough of the palette or the glow
values — those are read directly from `src/renderer/canvas.ts`'s own
`COLORS`/`GLOW` constants and doc comments. It records the decisions and
lessons that constrain future work on this renderer, and are easy to
silently undo or re-break: the shadow-state trap this ticket introduced
and how it was closed, the reuse of ADR-0006's time-entry rule, a
project-wide test-strength lesson this ticket produced two more instances
of in a single review round, a test-double gap that had been quietly
steering a rendering decision, and a genuinely new test category for this
repo (the render smoke test).

## Decision

### 1. Shadow state leaks across draw calls; `resetShadow`, not `save()`/`restore()`, closes it

`shadowBlur`/`shadowColor` are canvas **context state**, not per-call
arguments — once set, they apply to every subsequent draw call on the
same context until something changes them again. ADR-0006 recorded that
the renderer needed no `save()`/`restore()` before this ticket, because
every drawing function reset `textAlign`/`textBaseline` fresh before use
and nothing else was context-scoped. That stopped being true the moment
this ticket introduced glow: a glow left on by `drawGrid` or `drawSnake`
that then leaks onto `drawHud`'s or `drawOverlay`'s text is the
textbook failure mode, and no test can catch it — AC16 forbids any test
that asserts on canvas output, pixel data or draw-call snapshots, and a
leaked shadow is exactly that kind of assertion.

Decision: every function that turns a shadow on (`drawGrid`, `drawFood`,
`drawSnake`) turns it back off via `resetShadow(ctx)` before returning.
`drawHud` and `drawOverlay` additionally reset defensively on entry, and
`render()` resets once at the very top, before any drawing happens — belt
and braces on top of the per-function discipline, not a substitute for
it.

**Recorded honestly, not just the outcome:** `save()`/`restore()` is the
textbook fix for exactly this class of problem, and it was **not**
chosen. The reason is a test-infrastructure constraint, not a rendering
one: the fake `CanvasRenderingContext2D` double used across
`src/main.test.ts` and `src/renderer/canvas.render.test.ts`
(`src/test-support/fakeCanvasContext.ts`) does not implement `save`, so a
`ctx.save()` call would throw the moment any test exercised it. This is
the same shape of thing as point 5 below — a gap in test tooling shaping
a production decision — and the honest way to record it is as exactly
that, not to write it up as though `resetShadow` were chosen purely on
its own merits. The outcome is still defensible on its own terms:
`resetShadow` is cheaper than a `save`/`restore` pair, and the reviewer
verified by reading — the one lever available under AC16 — that nothing
leaks. But the reasoning that produced it and the reasoning that would
justify it in a vacuum are not the same reasoning, and only the first one
is true here.

### 2. Time still enters the program in exactly one place

The food's pulse needs a clock, but the renderer holds neither a
`performance.now()`/`Date.now()` call nor a mutable phase counter.
`render()` gained a fourth parameter, `timestampMs`; `src/main.ts`'s
`onFrame` callback — already handed a timestamp by `startTickLoop`,
previously discarded — now passes it straight through. `computeFoodPulseFactor`
and `computeFoodPulseMetrics` are pure functions of that timestamp (and,
for the latter, `cellSize`).

This is not a new rule; it is ADR-0006's rule ("the tick loop is the one
place wall-clock time enters this program") applied for the first time to
a case that actually needed a clock. Recording that it held is the point
— a future ticket reaching for `performance.now()` inside the renderer
for a new animation should read this as the second data point, not
wonder whether the rule was ticket-specific.

### 3. The biggest lesson: pin the breaking condition, not the clamping code path

`computeFoodPulseMetrics` clamps every derived value (`size`, `offset`,
`glowBlur`) to `>= 0` via `Math.max(0, …)`, guarding the same failure
class that made an unclamped pulse-derived radius crash
`createRadialGradient` with `IndexSizeError` before #6 landed. The first
version of this ticket shipped ten tests that appeared to exercise those
clamps.

Stage 5 review found otherwise: deleting all four clamps left every one
of those ten tests green. The reason is structural, not a test gap that
happened to miss a case — `Math.sin` is mathematically bounded to
`[-1, 1]` for any finite input, and at `FOOD_PULSE_MAX_INSET_RATIO = 0.22`
the clamps are **unreachable** with today's constants. This is the fifth
instance, project-wide, of the failure class ADR-0004 named first
(§"A test-strength lesson that generalises beyond this ticket" —
occupied-cell tests that stayed green with the filter disabled entirely):
a test that stays green when the rule it names is deleted arrives with a
tick mark and is worse than no test at all.

The fix was **not** to make the clamps testable by turning
`FOOD_PULSE_MAX_INSET_RATIO` into a runtime parameter so a test could
force it past the breaking point — that was considered and rejected in
review as speculative generality: a knob added solely so a test can turn
it. Instead, `FOOD_PULSE_MAX_INSET_RATIO` was exported as-is and a new
test pins the actual precondition the clamps depend on: the ratio must
stay below `0.5`, the point past which an unclamped inset would reach,
then exceed, `cellSize` and produce a negative food size. The ten
original tests were reworded, honestly, to say what they actually show —
that the functions' outputs stay in range across extreme inputs — rather
than implying they exercise clamps that are, at today's constants, dead
code.

**The verification request that couldn't work, and why that matters more
than the fix.** alfred (the orchestrator) subsequently asked for the
obvious-sounding check: remove the clamps, confirm the new test goes red.
That check cannot pass by construction — a test that pins the *value* of
a constant (`FOOD_PULSE_MAX_INSET_RATIO < 0.5`) does not read the clamp
code at all, so removing clamps elsewhere in the file cannot turn it red.
The implementing agent reported this instead of performing a verification
that would have looked successful without meaning anything; alfred
re-derived the same conclusion independently and confirmed it. The lesson
worth keeping on record, because it will recur the next time a solution's
*shape* changes: **whoever adopts a new solution's principle has to
re-derive its verification from that principle, not reuse the
verification written for the design it replaced.** "Remove the clamps,
watch the test go red" was the right check for a test that exercised
clamp code; it is not the right check for a test that pins a precondition
instead.

### 4. An algebraic tautology, found while re-running someone else's probe

A pre-existing test asserted `size + 2 * offset <= cellSize`. Since
`offset` is *defined* as `(cellSize - size) / 2`, substituting shows the
left side reduces to `cellSize` identically — for every value of `size`,
clamped or not, negative or not. **The test could not fail.** It was
replaced with independent assertions on `size` and `offset` directly, and
the replacement was confirmed (not merely argued) to go red against a
version of `canvas.ts` with the ratio raised to `0.6` and the clamps
removed, which produces `size = -4`.

This is the sixth instance of the same failure class named in point 3,
and worth flagging as a distinct data point rather than folding into that
count silently: it is the **first** instance in this project's history
that an *implementing* agent found unprompted, while re-running someone
else's review probe for an unrelated reason, rather than being surfaced
by a dedicated review or testing pass. The five instances before it (see
ADR-0001, ADR-0002, ADR-0004, ADR-0005, and point 3 above) were all found
by review or by a testing-focused pass looking specifically for this
shape of problem.

### 5. A test double, not a rendering constraint, had been steering a design decision

`createRadialGradient` was not used for the food's pulsing glow — the
technique used instead is `shadowBlur`/`shadowColor` plus a
shrinking/growing `fillRect`, the same approach used for the grid and
snake glow. AC16 is satisfied either way (a pulsing animation with no
shaders and no extra canvas layers), and the implementing agent flagged
the choice transparently as a judgement call in the PR description at the
time. What was not right in that framing: the actual cause was not a
rendering trade-off but a coincidence of test infrastructure — the fake
`ctx` double did not implement `createRadialGradient`, so reaching for it
would have made a chunk of the suite depend on jsdom's
`requestAnimationFrame` behaviour never firing synchronously, which is
true today but not a property anything pins.

Closed by extending the shared fake (`src/test-support/fakeCanvasContext.ts`,
also extracted in this round from a private helper duplicated inside
`src/main.test.ts` into one file both `main.test.ts` and
`canvas.render.test.ts` import) with a `createRadialGradient` stub that
returns an object with a no-op `addColorStop`. The visual choice itself
was **not** rebuilt around a radial gradient as part of closing this — the
point was to remove the tooling gap so a *future* visual decision isn't
pre-decided by it, not to relitigate this ticket's look.

### 6. The render smoke test — a new test category for this repo

Stage 5 review instrumented the suite and found `render()` had been
called exactly **once** across the entire prior test run, and that one
call threw immediately inside `drawBackground` — meaning four of the six
drawing functions in `canvas.ts` had never executed under test at all.
Confirmed as a real gap, not a false alarm, by forcing `drawGrid` to
throw as a control: every test in the suite stayed green.

Closed with `src/renderer/canvas.render.test.ts`: a smoke test that calls
`render()` across all four reachable `GameState.status` values and a
spread of timestamps, asserting **only** `not.toThrow()` — no colours, no
call counts, no argument assertions, no snapshots. This is deliberately
the narrowest possible test that still proves the drawing functions run
to completion without throwing. Review confirmed it is AC16-compliant
specifically because it says nothing about *what* was drawn, only *that*
drawing completed — and that it stays green if a future ticket changes
colours, glow strengths or scanline spacing. A later round widened the
matrix (cellSize = 1, the floor `computeCanvasMetrics` can ever produce;
a near-full snake built directly as `GameState` data since
`createGame`'s straight-line initial snake can't reach that shape through
the public API) to 6 cases × 3 timestamps = 18 tests, still `not.toThrow`
only.

Recorded as a boundary worth holding, not just a test that was added: the
moment a test in this file asserts anything about what the canvas *looks*
like, it has crossed AC16 and needs to be rewritten, not merely reviewed
more carefully.

### 7. No optimisation on suspicion

The renderer draws 54 grid lines per frame (27 vertical + 27 horizontal on
the fixed 28×28 grid) with `shadowBlur` active, plus roughly 180-190
scanline rectangles depending on viewport-derived cell size —
`shadowBlur` is understood to be the most expensive canvas 2D primitive
in common use. Nobody in this project's pipeline has run the game in a
browser (see the known limitation below), so nobody has measured this;
review judged it unlikely to matter on current hardware from reading the
code alone, which is a real but weaker form of evidence than a profile.

The available lever — the grid and scanline pattern are identical every
frame and could be pre-rendered once into an offscreen canvas, saving
roughly 240 draw calls per frame — was identified and **deliberately not
taken**. It touches the acceptance criterion that forbids additional
canvas layers, and there is no measured problem to justify it. Recorded
here as a known, ready lever for whoever first notices visible jank by
eye, not as deferred work with an implicit obligation attached.

## Consequences

- Every future drawing function added to `canvas.ts` that sets
  `shadowBlur`/`shadowColor` (or any other context-scoped property) must
  reset it before returning, following the pattern here — there is no
  automated guard for this, by AC16's own design, so it depends on
  whoever touches this file next reading this ADR or the file's own
  header comment.
- The fake canvas context (`src/test-support/fakeCanvasContext.ts`) is
  now shared and includes a `createRadialGradient` stub; extending it
  further as new canvas APIs are needed is preferable to letting gaps in
  it silently steer rendering choices again.
- `FOOD_PULSE_MAX_INSET_RATIO` is a pinned invariant (`< 0.5`), not a free
  constant — changing it past that boundary requires either re-deriving
  the clamp math or accepting that the clamps become load-bearing again,
  and the pinning test exists specifically to make that consequence
  visible at review time instead of at runtime.
- The render smoke test (`canvas.render.test.ts`) is the template for how
  to add coverage to a file under AC16-style "no canvas-output assertion"
  constraints elsewhere in this project, if that pattern is ever needed
  again: assert completion, never content.
- The known, deliberately-not-taken offscreen pre-render optimisation
  (point 7) stays on record as the first thing to reach for if jank is
  ever reported, rather than something to rediscover from scratch.

### Known, accepted limitations — not forgotten defects

- **Nobody has run this game in a real browser.** True since #6
  (ADR-0006 recorded it there) and it matters more here, since this
  ticket's entire acceptance criterion *is* the visual result. Embedded
  browser tooling timed out for the implementing agent, same failure mode
  as #6. Cross-browser behaviour (current Chrome, Firefox, Safari) is
  entirely unverified; this should be closed with an actual look before
  the visuals are treated as settled.
- **A test's inline comment initially over-claimed what it exercised.**
  One test's comment stated it exercised the `cellSize > 0` fallback
  independently of the `Math.max(0, …)` clamps. Removing only that
  fallback (clamps intact) leaves every test green — the property the
  comment described is real (a non-positive `cellSize` does yield a
  zero size/offset) but it is currently held *by* the clamps, not by that
  fallback independently. The comment was corrected to say only what was
  confirmed by actually removing the fallback in isolation. Worth noting
  as a subtler sibling of point 3/4 above: not "proves nothing," but
  "proves something real, just not the thing the label claimed."
- **The "is periodic" pulse test checks one sample point, not a spread.**
  It confirms the pulse factor repeats after one full period at a single
  checked offset; it does not sample across the cycle to rule out a
  function that is periodic at that one offset by coincidence.
- **The AC16 boundary's thinnest point in this codebase is not in this
  ticket.** `src/main.test.ts` asserts on `fillRect.mock.calls.length` to
  prove the tick loop stops advancing after a fatal error — a call count,
  not a snapshot or a colour assertion, so it does not cross AC16 as
  written, but it is the closest any test in the project comes to the
  line. It originates in #6 and was deliberately left as-is here rather
  than pulled into this ticket's scope.
