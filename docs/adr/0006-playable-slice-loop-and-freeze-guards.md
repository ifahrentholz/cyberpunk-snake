# 0006. Playable slice: catch-up cap, the freeze-guard criterion, and the composition-layer state guards

Date: 2026-08-27
Status: Accepted

## Context

Issue #6 is where five already-merged, invisible tickets (#2–#5, #13) become
a game a human can actually play: `src/composition/loop.ts` (a fixed-tickrate
`requestAnimationFrame` accumulator), `src/renderer/canvas.ts` (a read-only
canvas renderer), and real `composeApp()` wiring in `src/main.ts` replacing
the four unwired placeholders. 133 tests across 9 files, `npm run typecheck`,
`npm run lint` and `npm run build` all pass.

Deliberately **not** in scope: the cyberpunk visual treatment (palette,
glow, background grid, food-pulse animation, scanlines) is issue #16, a
separate slice, blocked by this one. The renderer here is intentionally
plain — solid fills, readable contrast, no `save()`/`restore()` needed yet
(see the last section below). The reason belongs on record, because it
reads as an omission otherwise: the human needs to be able to play early
and judge tick rate, control feel and grid size *before* anyone polishes
the visuals on top of it. Polishing first would mean tuning those things
against a look that might still change underneath them.

This ADR is not an implementation walkthrough. It records the decisions
that constrain future work: the time-budget math and its cap, the
freeze-guard criterion the review round derived (the most reusable part of
this ticket), a state-management decision that was proposed, reversed and
re-decided during review, a scope cut to public surface, and the
consequences of the AC that forbids canvas-output tests.

## Decision

### 1. Fixed timestep with a hard catch-up cap; negative deltas cost nothing

`accumulate(carryMs, deltaMs, tickMs)` in `src/composition/loop.ts` is pure
— no DOM, no clock, every input a parameter — which is what makes it the
one part of the tick loop worth a unit test at all; it is also the only
part of this file that can be straightforwardly wrong, and it is the only
part with tests written directly against it (`startTickLoop` is tested
through a fake frame source instead, since it is a thin, largely
untestable-in-isolation wrapper).

`MAX_CATCHUP_TICKS = 5` caps how many ticks a single frame may catch up on.
Past the cap, surplus time is **dropped**, not queued as debt. Queueing it
has two bad outcomes: either the frame itself stalls running a huge tick
burst (the classic spiral of death, where each stall produces an even
bigger `deltaMs` on the next frame), or, spread out, the game visibly
fast-forwards to catch up. Losing a fraction of a second of simulated time
after a hidden tab regains focus is not observable as a bug; a
multi-second burst of snake movement is. A negative `deltaMs` (a
monotonic-clock hiccup) is treated as zero elapsed time rather than
allowed to cancel out real carried-over time.

### 2. The freeze-guard criterion

The first version of the tick loop wrapped only `options.onTick()` in a
try/catch. `options.onFrame(timestampMs)` — the render call — ran
unguarded, sitting between the tick loop and the `requestFrame(frame)`
call that schedules the next frame. A throw from the renderer would have
escaped uncaught, never reached `onError`, and silently stopped the loop:
no further frame scheduled, nothing visibly wrong, no console output
anyone would necessarily see.

Two details make this worse than a symmetrical gap next to the `onTick`
guard: `onFrame` runs on **every** frame, `onTick` only when a tick is
due, so the unguarded path was the more frequently exercised one. And if
the **very first** frame throws, before any tick has ever run, there is no
previously-drawn frame to freeze on — the start screen simply never
appears at all. That violates the start-screen acceptance criterion more
directly than the game-over one; "the loop freezes mid-game" at least
implies the game was visibly running a moment before.

This was fixed (`dc5ab4f`) by wrapping `onFrame` the same way: try/catch,
`stopped = true` and `onError` on a throw, `requestFrame` only called when
`!stopped`.

The criterion the review round derived from working through this, stated
so it doesn't need re-deriving next time:

> A call site deserves a guard when the condition under which it can throw
> depends on state that can change **after the loop has already run
> successfully** — a renderer that starts throwing after rendering fine for
> minutes (context loss, a browser extension, a future ticket introducing
> `createRadialGradient` with a bad argument). That is the definition of a
> silent freeze: "it worked, and then it silently stopped working." A call
> site whose only throw condition is a caller-supplied constant that
> cannot change over the page's lifetime does not qualify — that one fails
> loudly on the very first call, or never.

Applying it to every call in this file, so the next person doesn't have to
re-derive it either: `accumulate`'s own throw (`tickMs <= 0`) is noise
under this criterion — `tickMs` is a constant set once by the caller, so a
bad value fails on frame one, visibly, not silently, minutes in.
`requestFrame` itself getting a guard is a low-value suggestion, not a
gap: if the browser's own scheduler is broken, there is nothing left to
save except whether the failure is visible, and it already would be
(nothing renders at all). `onFrame` was the one real hit — the only call
in this file whose failure condition can plausibly first become true
after the loop has been running fine.

Record that this criterion exists as a first-class thing, not just as the
resolution to one bug: without it, the natural next move is to keep
enumerating call sites and wrapping each one "to be safe," which is
exactly the enumerate-forever failure mode ADR-0001 rejects for the import
boundary and the purity guard (`no-restricted-globals` catching only the
spellings someone thought of in advance). A structural criterion for
*which* calls need a guard is the equivalent, for this problem, of
ADR-0001's structural (not enumerated) import-boundary rule.

**Deliberately preserved, not tightened further:** the render call still
runs unconditionally even when a tick in the same frame just failed and
set `stopped = true` — the guard around `onFrame` does not skip it on
`stopped`. The obvious-looking tighter fix would be to skip rendering once
the loop is stopping, and it would be wrong: it would silently remove the
one thing that lets the last valid state stay on screen instead of leaving
stale pixels with no feedback at all. Two mutation probes, both reverted
after, show the test suite actually distinguishes "guard missing" from
"guard overcorrected" rather than merely asserting one direction: removing
the `onFrame` try/catch entirely reds exactly the two dedicated `onFrame`
guard tests and nothing else; applying the overcorrected fix (skip
`onFrame` once `stopped`) reds exactly the onTick-guard test and the
dedicated "OVERCORRECTION GUARD" test, leaving the two `onFrame` guard
tests green. Disjoint failure sets — that is the evidence the tests
actually separate these two failure modes rather than happening to catch
both by coincidence.

### 3. `awaitingFirstMove` stays an explicit flag — a proposal to derive it was considered and rejected

The reducer (`src/logic/game.ts`) has no `ready → running` transition
triggered by a direction key: a `tick` action while `status === 'ready'`
already moves the snake and flips the status to `'running'`, regardless of
whether a direction was ever queued. So the composition layer must
withhold ticks itself until the player's first direction key press
(AC3/AC4) — `step()`'s own status handling is not sufficient on its own.

`src/main.ts` tracks this with an explicit boolean, `awaitingFirstMove`,
reset to `true` on `restart` and flipped to `false` the first time a
`direction` action is dispatched while `status === 'ready'`.

During review, replacing this flag with a derived check —
`state.status === 'ready' && state.queuedDirection === null` — was
proposed, on the grounds that an explicit boolean tracking something the
reducer state already encodes is a second source of truth that can drift
from the first. The reviewer checked the equivalence structurally rather
than taking it on faith: the only path back to `status: 'ready'` in the
reducer is `restart()`, and `restart()` always sets `queuedDirection` to
`null` in the same object literal (`src/logic/game.ts`, `restart()`), so
the two conditions are provably equivalent for every reachable state today.

The reviewer verified the equivalence and still voted to keep the explicit
flag. The reason: no test in the suite asserts the *premise* the
derivation depends on — that `restart()` always nulls `queuedDirection`
alongside `status`. A future reducer change that broke that pairing (for
example, a hypothetical restart variant that preserves the queued
direction) would silently break the derived check with no test failure
anywhere to flag it, because nothing currently pins that specific
invariant. An explicit flag owned entirely by the composition layer has no
such dependency on an unstated invariant elsewhere. This is a revised
decision, not the original plan: the derivation was seriously considered,
found structurally correct, and rejected anyway because "correct today"
and "guarded against silently becoming wrong" are different properties.

### 4. Unused public surface that can bypass an AC is risk with no offsetting value — `dispatch` was removed, not merely left alone

`dispatch` was originally exposed on `AppComposition` alongside
`advanceTick`. Review found it was used by **zero** tests (every test
drives the game through `advanceTick`), and that calling it directly —
`app.dispatch({ type: 'tick', rng: Math.random })` — bypassed the
`awaitingFirstMove` gate entirely, moving the snake before the first
direction key press and violating AC3/AC4 directly.

It was removed from the public interface and the returned object
(`594f424`), not hardened. Duplicating the `awaitingFirstMove` check
inside `dispatch` was considered and rejected: it would have created two
places that both have to stay correct, for a method nothing in the
codebase calls. `advanceTick` remains the sole way to advance the game
from outside `composeApp`, gate included; `dispatch` still exists as an
unexported closure used internally by `advanceTick` and the keyboard
binding.

### 5. Injecting a dependency is not the same risk as exporting a capability

`composeApp(doc, frameSource?)` (`594f424`) makes the tick loop's frame
source injectable — `frameSource: { requestFrame?, cancelFrame? }` — with
production behaviour unchanged (both default to the real
`window.requestAnimationFrame`/`cancelAnimationFrame`). This looks like
the same shape of change as the `dispatch` removal above — new surface
added to `composeApp` — and was checked against the same standard rather
than assumed safe by analogy.

The difference the review confirmed: `frameSource` passes through exactly
the two functions `startTickLoop` already accepts as parameters, and it
opens no state transition the game logic doesn't already know about. In
the worst case of a hostile or broken caller, a bad `frameSource` breaks
the *loop's scheduling* — frames stop being requested, or fire at the
wrong times — not the *game rules*. `dispatch` could move the snake before
the player pressed a key, which is a rules violation; `frameSource` cannot
produce an equivalent rules violation, only a scheduling one. The
practical payoff: this is what made the error-banner path
(`handleFatalTickError`) deterministically testable — a stubbed
`frameSource` can fire a single synthetic frame whose canvas context
throws on the very first draw call, with no real elapsed time and no
dependency on `requestAnimationFrame` actually running in the test
environment.

### 6. No canvas-output tests, by AC — what that costs and why it's accepted

AC16 forbids any test that asserts on canvas output, pixel data or
draw-call snapshots — such tests would go red the moment issue #16's
visual treatment lands and would block that slice on updating brittle
pixel assertions instead of reviewing the actual visual change. The only
part of `src/renderer/canvas.ts` under unit test is
`computeCanvasMetrics`, the pure sizing/DPR math; `render()` itself and
its drawing functions are verified by eyeballing `npm run dev`, not by
test.

Named plainly: there is **structurally no test** that would catch a wrong
`save()`/`restore()` pairing, a `ctx.font` left unset before a draw call,
or a canvas context that silently went unusable. The renderer was
therefore read by eye during review specifically for these classes of
bug, and one finding from that reading matters for #16 specifically:
today the renderer needs no `save()`/`restore()` at all, because every
drawing function (`drawHud`, `drawOverlay`, ...) sets `textAlign` and
`textBaseline` fresh before using them rather than relying on values left
by a previous call. That stops being true the moment #16 introduces
`ctx.shadowBlur`/`ctx.shadowColor` for the glow effect: those are context
state that leaks across draw calls the same way an unset `font` would, and
at that point the absence of `save()`/`restore()` becomes a real bug
waiting to happen rather than a currently-harmless omission. #16 should
not have to rediscover this by reading the whole file again.

## Consequences

- The tick loop cannot produce a silent freeze on either its tick path or
  its render path, and the freeze-guard criterion above gives future
  tickets a way to decide whether a new call site needs the same guard
  without re-deriving it from scratch or over-applying it everywhere.
- `AppComposition`'s public surface is exactly `canvas`, `getState`,
  `advanceTick`, `stop`, `highscore` — every one of them either read-only
  or gated. There is no way to reach into the running app from outside and
  violate AC3/AC4.
- `frameSource` injection made the error-banner path testable without real
  elapsed time; see `src/main.test.ts`'s "AC13 wired end to end" test.
- `awaitingFirstMove` remains a second, composition-owned piece of state
  next to the reducer's own `status`/`queuedDirection`. That duplication
  was an explicit, reasoned trade — see point 3 — not an oversight; anyone
  touching `restart()`'s handling of `queuedDirection` should know a
  structural argument for removing the flag was already made, checked,
  and rejected specifically because nothing pins the invariant it would
  depend on.

### Known, accepted limitations — not forgotten defects

- **`requestFrame(frame)` (the very first frame request, and the one
  inside `frame` itself) sits outside any try/catch.** Correct under the
  criterion in point 2: if the browser's own scheduler is broken there is
  nothing left to save except whether the failure is visible, and it
  already would be, since nothing would ever render. Deliberately not
  wrapped.
- **`handleFatalTickError` (in `src/main.ts`) is not guarded against
  throwing itself.** Review looked specifically for a path that would
  hurt here and did not find one: `errorBanner` is a reference held
  independently of the canvas, DOM property writes (`.textContent`,
  `.hidden`) do not throw, and the failure modes that would make
  `onFrame` throw in the first place (canvas context loss, a hostile
  browser extension) affect the canvas context, not a plain `<div>`.
- **`resizeCanvas` calls `canvas.getContext('2d')` a second time**,
  separately from the context `composeApp` already holds. Real browsers
  return the same context both times; changing the signature to thread
  the existing context through would touch a function issue #16 is
  already going to touch for the glow/gradient work, so it was left alone
  rather than reworked twice.
- **Overlay text can theoretically overflow a very small viewport.**
  `computeCanvasMetrics` has a `Math.max(1, ...)` floor on cell size but
  nothing bounds the overlay title/subtitle font sizes against the
  resulting canvas size. Accepted as an edge case, not fixed here.
- **Nobody has run this game in a real browser yet.** Not the coding
  agent (the embedded browser pane timed out twice), not the reviewer,
  not the human. Every acceptance criterion about visible behavior —
  the start screen appearing, movement rendering smoothly, the game-over
  overlay, Space not scrolling the page — is verified today only through
  jsdom integration tests in `src/main.test.ts` plus reading the code.
  Cross-browser behaviour (the AC requiring current Chrome, Firefox and
  Safari) is entirely unverified. This is the most important open
  question this ticket leaves behind, and it should be closed with an
  actual look in a browser before anyone treats tick rate, control feel
  or grid size as settled — which is the whole stated purpose of shipping
  a plain-looking playable slice before #16's visual polish.
