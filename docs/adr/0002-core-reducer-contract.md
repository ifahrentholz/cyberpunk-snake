# 0002. Core reducer contract: pure state machine, injected randomness, executed-direction turn rule

Date: 2026-08-25
Status: Accepted

## Context

Issue #3 builds the seam every later gameplay ticket (#4 food/growth/score,
#5 input, #6 renderer/tick loop, #7 persistence, #9 polish) sits on top of:
`createGame(config, rng)` to build the initial state and `step(state,
action?)` to advance it. Issue #1's spec requires the game logic to be
testable without a DOM and without real timing, which only holds if the
reducer is a pure function end to end.

## Decision

**`createGame` / `step` are a pure reducer pair.** Same `GameState` and same
`GameAction` in, same `GameState` out, every time; no I/O, no globals. Given
the ESLint purity guard from ADR 0001 already forbids `src/logic` from
touching the DOM, `Math.random` or the clock, the reducer's only remaining
job is to not smuggle non-determinism in through its own state shape or
parameters. `GameState` is plain, serializable data — no functions, no
class instances, no circular references — so it can be `JSON.stringify`'d,
diffed, snapshotted and replayed without special-casing; `game.test.ts`
asserts a JSON round trip survives unchanged as a direct check on this.

**Randomness is injected, time is excluded, not just discouraged.** `rng:
Rng` (`() => number` in `[0, 1)`) is a required parameter of `createGame`,
never read from a module-level default or `Math.random`. `step` never asks
what time it is; a `tick` action is how the caller says "one unit of game
time passed," and the reducer has no opinion about how long that unit is or
when it occurred. The payoff is measured, not assumed: of the 8 test runs
added across `game.test.ts` in this stage, 5 force a specific `rng`
sequence to pin an otherwise-random food placement, and all 8 are
order-independent — running them in any order, or the suite as a whole
twice, produces byte-identical `GameState` values. That's the concrete
evidence that "pure reducer, injected randomness" isn't just a stated
intent here.

**Turn validity is checked against the last *executed* direction, not the
last *queued* one.** A `direction` action only ever writes to
`queuedDirection`; the actual `direction` field only changes inside
`advance`, once per `tick`, and `resolveMoveDirection` compares the queued
direction against `state.direction` (last executed), not against whatever
was queued a moment before. This is what stops the classic Snake bug: two
direction inputs arriving in the same tick window (e.g. right → up → left,
faster than the tick rate) cannot compound into a 180° reversal, because
the second input is validated against the direction the snake is actually
still travelling in, not the first input. `game.test.ts` has a dedicated
case for this ("checks the queued direction against the last EXECUTED
direction, not the last queued one").

**Collision order in `advance`, deliberately leaving room for #4.** Each
tick: resolve the move direction, compute the candidate head cell, check
grid bounds (`over` on failure), then check self-collision against the
body *excluding the current tail cell* (`over` on failure), then commit the
new head/body. The tail-cell exclusion exists because the tail is about to
vacate that cell on a non-growing move — without it, a snake would falsely
collide with the cell its own tail is leaving. This ordering intentionally
stops short of a food check: there is no "did we just eat" branch yet.
That gap is deliberate, not an oversight — see the next point.

**The state shape is pre-shaped for #4, but inert here.** `food: Position`
and `score: number` already exist on `GameState` and are threaded through
`createGame`, `restart` and every `step` transition, but nothing in this
ticket's `advance` reads or writes them in response to the snake's
position — `game.test.ts` has an explicit test ("does nothing special when
the head reaches the food cell") pinning that inertness as current, correct
behaviour, not a bug to be found later. The reasoning: #4 should be able to
add eating, growth and score entirely as new *behaviour* — a food check
inserted into the existing collision sequence, plus a body-growth branch —
without changing what `GameState` or `GameAction` look like. If `food`/
`score` were bolted on only when #4 needed them, #4 would be doing a
contract change and a behaviour change at once; keeping the fields here and
inert keeps those two changes separate.

**Open question, deliberately left open for #4: where does `rng` come from
at tick time?** `step` has no third parameter and no way to reach a random
number generator when a `tick` action causes something that needs one
(placing new food after eating). `GameState` must stay serializable, so
stashing a live `Rng` closure inside it is not an option. The recommended
shape — adding `rng` as an optional field on the `tick` action itself
(`{ type: 'tick'; rng?: Rng }`) rather than a third parameter to `step` — is
recorded as a comment on issue #4 and marked there as blocking for that
ticket's start. This ADR intentionally does not decide it; #4 owns that
decision and should record it in its own ADR entry (or amend this one) once
made.

### `GameConfig.initialSnakeLength?` (not in the original ticket)

`initialSnakeLength` (optional, default `3`) was added to `GameConfig`
during this ticket even though issue #3 doesn't mention it. It exists
because AC8 ("self-collision ends the game") is untestable through the
public API without it: an exhaustive search performed during the stage-6
review (depth 10, every direction sequence, a grid large enough to remove
wall collisions as a confound) found that a snake of length 3 *or* 4 cannot
reach a self-collision through `createGame`/`step` at all — the only way a
snake that short could hit itself is via a direct 180° reversal, and that
input is already rejected by the turn rule above. Self-collision only
becomes reachable at length 5. Making the starting length configurable,
with a default that leaves the standard 28×28 game's behaviour unchanged,
is what makes AC8 provable rather than asserted. `game.test.ts`'s
self-collision case sets `initialSnakeLength` explicitly for this reason.

### The AC11 bug and what it says about test coverage

During this ticket's first review pass, `step` buffered a `direction`
action that arrived while `status === 'paused'` into `queuedDirection` and
silently applied it on the next tick after `resume` — a direction the
player picked mid-pause, executed without their seeing it happen. That is
a literal violation of AC11. The fix (commit `83d41ad`) makes `step` return
`state` unchanged for a `direction` action while paused, instead of
queuing it.

The important part isn't that a bug shipped in review; it's *why* it
shipped: **there was no test for AC11 at all.** The pause test that existed
at the time exercised pause/resume without ever sending a direction input
during the pause window, so a green suite said nothing about this
acceptance criterion one way or the other. The lesson generalises: an
acceptance criterion with no test of its own is unverified regardless of
how green the rest of the suite is — "the tests pass" and "this AC holds"
are only the same claim if every AC actually has a test behind it.

Two things were added to close that gap for good, not just for AC11:

- A regression test ("ignores a direction input that arrives while
  paused (AC11)") pinning the fix.
- A second, deliberately adjacent test ("keeps a direction queued before
  pausing valid after resume") pinning the boundary of the fix: `pause`
  itself does **not** clear `queuedDirection`. A direction entered *before*
  pausing remains valid and executes on the next tick after resume; only
  input that arrives *during* the pause is dropped. Without this second
  test, a future "simplify pause to clear queuedDirection entirely" change
  would pass the AC11 regression test while breaking a different,
  legitimate expectation — this test exists specifically to catch that
  over-correction.

Re-review verified both tests actually test something by mutation testing:
reverting `83d41ad` by hand and re-running the suite turned both new tests
red, confirming they fail without the fix rather than passing vacuously.

## Consequences

- `createGame`/`step` are fully exercised without a DOM, a timer or
  `Math.random`, in well under two seconds (`game.test.ts`'s 23 cases run
  in milliseconds) — the payoff ADR 0001 promised for the layer boundary.
- #4 can add food/growth/score as pure behavioural extension of `advance`
  without renegotiating `GameState` or `GameAction`, except for the one
  open question above (`rng` delivery at tick time), which is explicitly
  #4's to resolve before it starts.
- #5 (input) and #6 (renderer/tick loop) can drive the reducer through
  `GameAction` values alone; neither needs to know how a tick is timed or
  how a direction is chosen, only that `step` is deterministic given state
  and action.
- The AC11 gap is closed, but the general lesson — "no test per AC means
  no evidence per AC" — is the more durable takeaway for every ticket after
  this one; it does not automatically apply itself to future ACs, someone
  still has to write the test.

### Explicitly rejected

- **No `Object.freeze` on `config` (or any other state slice) inside
  `createGame`.** `GameConfig`'s fields are already `readonly` at the type
  level, and no path in `src/logic` mutates state in place — `advance` and
  `restart` both build new objects via spread/`.slice()`. A runtime freeze
  would guard against a mutation path that doesn't exist, at the cost of a
  slightly less legible reducer (freezing calls scattered through
  `createGame`) and a small but nonzero runtime cost on every game creation.
  Raised in review and not disputed on reflection: TypeScript `readonly` +
  "nothing in this codebase ever mutates in place" is the enforcement
  mechanism, not a runtime guard belt-and-braces on top of it.
- **`snake`/`food` and `initial.snake`/`initial.food` intentionally share
  object/array references immediately after `createGame`**, rather than
  being deep-cloned into `initial`. This is safe specifically because nothing
  in `src/logic` mutates in place: `advance` always produces a new `snake`
  array (spread + `.slice()`), so `initial.snake` is never at risk of being
  changed out from under `restart`. Verified empirically, not just argued:
  deep-freezing the object graph returned by `createGame` and running 10
  ticks through `step` throws nothing, i.e. no code path anywhere attempts
  to write into a frozen cell. The reasoning is recorded as a code comment
  next to the sharing in `game.ts`; this ADR is where the "why is this
  safe" argument lives in full, since a code comment is not the place for
  the empirical verification story.
