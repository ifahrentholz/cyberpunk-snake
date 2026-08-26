# 0004. Food placement, growth and scoring: mandatory tick `rng`, fixed collision-then-growth order, enumeration-based placement

Date: 2026-08-26
Status: Accepted

## Context

Issue #4 fills in the one gap ADR 0002 deliberately left open when it built
the reducer contract: "where does `rng` come from at tick time?" `food:
Position` and `score: number` already existed on `GameState`, inert, held
in reserve exactly so that #4 could add eating, growth and score as new
*behaviour* inside the existing `advance` collision sequence without
renegotiating what `GameState` or `GameAction` look like. This ADR is a
continuation of ADR 0002's contract, not a competing account of it; where
this ticket changed something ADR 0002 stated, that is called out
explicitly below rather than left for a reader to notice by diffing.

The problem #4 had to solve: respawning food after an eat needs a random
draw at the moment a `tick` action is processed, but `GameState` must stay
serializable (ADR 0002), so it cannot carry a live `Rng` closure. Three
shapes were on the table for getting randomness to that point: an optional
`rng` on the `tick` action, a mandatory `rng` on the `tick` action, or a
third parameter on `step` itself.

## Decision

**`rng` is mandatory on the `tick` action, and `step`'s `action` parameter
is now required as a direct consequence.** `GameAction`'s `tick` variant is
`{ type: 'tick'; readonly rng: Rng }`, not `{ type: 'tick'; rng?: Rng }`.
This is a breaking change to the contract ADR 0002 fixed: `step` used to
default a missing `action` to `{ type: 'tick' }`; that default is gone,
and every caller must now pass an explicit action, and every `tick` action
must now carry an `rng`.

This was escalated to the human rather than decided unilaterally, and the
mandatory shape was chosen on the principle that **a construction which
fails closed beats one that fails open**: with `rng` optional, a call site
that forgot to supply one would compile fine and only misbehave once a
`tick` actually needed to respawn food — a defect that would most likely
have surfaced downstream, inside #6's tick loop, far from the code that
caused it. With `rng` mandatory, the same mistake is a compile error at
every call site, today, in this ticket. The accepted price was concrete
and paid up front: roughly 30 call sites across the pre-existing test
suite needed rewriting from `step(state)` / `step(state, { type: 'tick' })`
to `step(state, tick(rng))`-shaped calls. A regression audit after the
rewrite confirmed not one assertion was weakened in the process — the
tests assert exactly what they asserted before, just through an explicit
action. This is the same "fails closed, not open" principle ADR 0001
records for the purity guard's allow-list versus its original deny-list;
a project that keeps arriving at the same principle from different
directions should be able to see that it did, which is the point of
writing it down here rather than re-deriving it silently a third time.

**`rng` is consumed only on a tick that actually eats food, and this is
pinned by a committed test, not only known from a one-off check.** The
`describe('step: rng draw count pins "exactly one draw per eat, never
otherwise"')` block in `src/logic/game.test.ts` wraps a deterministic
`Rng` in a call-counting shim and drives it through the public
`createGame`/`step` seam only (it never reaches past that seam into the
unexported `pickFoodPosition`), asserting: one draw on a tick that lands
on food, zero draws on a non-eating tick, zero on a wall-collision tick,
zero on a self-collision tick, and zero on a tick dispatched while
`status` is `'paused'` (paused ticks are a no-op in `step`, see ADR 0002's
AC11 fix). This matters beyond the fact that it holds: if the number or
timing of `rng` draws depended on tick history in some unspecified way,
any future test that predicts an exact `rng` sequence for a scripted
play-through would be fragile for a reason indistinguishable from
ordinary flakiness, rather than for a reason traceable to a design
defect. Pinning "exactly one draw per eat, never otherwise" in a
committed test, rather than only in a reviewer's memory, is what keeps
deterministic-sequence tests deterministic as the reducer grows.

Verified by mutation, following the precedent ADR 0002 set of recording
*how* a claim was checked, not just asserting that it was: inserting an
unconditional, speculative `rng()` call at the top of `advance` turns
four of the five cases red (eat, non-eat, wall collision, self collision).
The fifth case — the paused tick — stays green under that specific
mutation, and that is not a weak test: a paused tick never reaches
`advance` at all, since `step` returns early for `status === 'paused'`
before `advance` is ever called, so a mutation inside `advance` has
nothing to hit. That case pins a different, still-real invariant (the
early return in `step`), confirmed separately by removing that early
return by hand, which does turn the paused case red. Recorded here so a
later reader doesn't mistake a green case, under one particular mutation,
for a hole in the coverage.

One honest note on how this paragraph came to say what it now says: an
earlier draft of this ADR claimed this invariant as "pinned" while the
only verification of it had run in a throwaway script during review,
never committed. That gap was caught by the documentation pass, not by
review or by the test suite — the act of writing the claim down forced a
check of whether it was actually true. It wasn't, yet; it is now.

**The tick order is fixed, deliberately, including the edge case it
creates.** Per tick: resolve the queued direction, compute the candidate
head, check wall collision, check self-collision against the body with the
tail already excluded, check the food, then either grow (keep the tail) or
advance normally (drop the tail). ADR 0002 already fixed the
tail-exclusion rule for self-collision and explicitly left the food check
unwired; this ticket wires it in at the position the spec's acceptance
order requires, immediately after self-collision and before the
grow/drop branch — self-collision is judged against the pre-growth,
tail-dropped body, before it is known whether this tick also eats food.

Consequence: a new head landing exactly on the *current* tail cell is
never ruled a self-collision (the tail-dropped body doesn't contain that
cell any more). If that same cell also happens to hold food, the snake
grows and the tail is *not* dropped, so for exactly one snapshot the new
head and the old tail occupy the same cell — an overlap, not a collision.
It self-corrects on the next non-eating tick, once that tail cell is
finally dropped again.

This order was implemented literally, as specified, rather than quietly
reordered to make the awkward case disappear. Review then asked whether
the case is reachable at all through normal play and found, inductively,
that it is not: `pickFoodPosition` always excludes every current cell of
the snake — head, body and tail alike — at the moment food is placed, and
any cell that later becomes the tail was necessarily visited by the head
first, which would have already eaten any food sitting there. So a live
game, built only through `createGame`/`step`, can never have food waiting
on the current tail's cell in the first place; the head-on-tail-with-food
overlap is real per the mandated order, but only reachable by hand-
constructing a `GameState` directly, which is exactly what the dedicated
test in `game.test.ts` does. The reachability finding was verified this
way rather than taken on the implementer's word.

**Food placement enumerates free cells rather than rejecting random
draws.** `pickFoodPosition` walks the grid, collects every cell not
occupied by the current snake, and indexes into that list with
`rng()`. This terminates even when the grid is nearly full (rejection
sampling would stall as the free fraction shrinks) and is exactly
predictable for a given `rng` sequence, which is what lets
`game.test.ts` pin specific food positions rather than only asserting
"not on the snake." `pickFoodPosition` itself is unchanged from #3; this
ticket's only change is calling it a second time, mid-`advance`, on an
eating tick.

**A full grid throws; no win condition exists or was invented.** With zero
free cells, `pickFoodPosition` throws `'No empty cell available for food
placement'`. Issue #1's spec has no win condition, and none was added
here to paper over the case — the throw is deliberate and is pinned by a
dedicated test rather than left as an unverified latent path. On the
standard 28×28 grid this requires the snake to grow to 784 segments, so
it is not a near-term concern in play, but it is a real, reachable
outcome of this reducer as written. The consequence worth recording is
about where it surfaces, not whether it can happen: an uncaught throw
inside a `requestAnimationFrame` callback does not crash the tab, but if
the tick loop schedules its *next* frame at the end of the same
synchronous callback (the common pattern), the throw aborts that
iteration before the next frame gets scheduled — the game would simply
freeze on the last rendered frame, with no game-over state, no error
surfaced to the player, and no further ticks. This reducer has no
opinion about `requestAnimationFrame` at all (see ADR 0001's layer
boundary) and cannot handle it; handling it is explicitly routed to #6
(the tick-loop/renderer ticket) as an acceptance item, not treated here as
a defect of this ticket.

**A test-strength lesson that generalises beyond this ticket.** The two
tests guarding "food never appears on an occupied cell" originally ran on
a 6×6 grid with a length-4 snake across 20 seeds, plus a sparse 28×28 grid
with a single seed. In review, the occupied-cell filter inside
`pickFoodPosition` was disabled outright — and both tests stayed green,
because on a grid where the snake covers only 10–20% of cells, a handful
of fixed seeds can all miss an occupied index by chance even with no
filter running at all. The implementation was correct throughout; the
tests were reassuring, not protective. They were rewritten around a grid
that leaves exactly one legal free cell across 30 fixed seeds, so a
disabled filter would draw from three cells (two of them occupied) and
the odds of 30 straight seeds all coincidentally landing on the one legal
cell by chance are (1/3)^30 — the filter-removal probe now turns both
tests red on the first attempt.

The general lesson is worth stating plainly rather than leaving implicit
in the diff: **a test that stays green when the rule it names is deleted
is worse than no test, because it arrives with a tick mark.** This is the
third instance of that exact class of finding in this project. ADR 0001
records a purity guard that looked enforced and was bypassable by five
one-liners with zero lint signal. ADR 0002 records an acceptance criterion
(AC11) that had no test at all while the rest of the suite stayed green.
This is the same failure shape a third time, now inside a single test
rather than a missing one — a project that keeps finding this should stop
treating each instance as isolated.

The trade in the rewritten tests is recorded honestly rather than left to
be discovered later: a one-free-cell grid no longer exercises
`pickFoodPosition`'s index arithmetic across a large free-cell set — it
only proves the filter is applied at all. That breadth is carried instead
by the sibling placement/determinism tests on the standard 28×28 grid,
which were checked, not assumed, to still cover the wide-open-grid index
path correctly.

**`GameConfig.initialSnakeLength` gets a second, independent reason to
exist.** ADR 0002 introduced this optional config field so that
self-collision (AC8) could be reached through the public API at all — a
default-length-3 snake cannot self-collide without a rejected 180° input.
This ticket reuses the same field to construct the length-4 snake needed
for the AC7 tail/food edge-case test above. Recording that it is used a
second, independent way here is what makes its purpose read as
deliberate infrastructure rather than a one-ticket special case.

## Consequences

- Every `tick` action processed anywhere in this codebase — tests, and
  eventually #6's real tick loop — must supply a live `Rng`. There is no
  fallback, default or internal `Math.random`, matching the purity
  guarantee ADR 0001 enforces structurally for all of `src/logic`.
- Food eating, growth and score are fully specified and fully tested in
  the logic layer, with the tail/food overlap edge case handled per the
  mandated order and proven unreachable through normal play rather than
  merely asserted so.
- The full-grid throw is a known, deliberate, currently-unhandled outcome
  whose real-world exposure point is #6's tick loop; #6 carries an
  acceptance item for it, tracked there rather than worked around here.
- The occupied-cell test rewrite is this ticket's evidence that a green
  assertion and a protective assertion are not the same claim — the third
  time this project has had to relearn that distinction the hard way (see
  ADR 0001, ADR 0002).

### Explicitly rejected

- **Optional `rng` on the `tick` action** (`{ type: 'tick'; rng?: Rng }`),
  the shape ADR 0002 had tentatively recommended as an open question.
  Rejected once weighed against mandatory: optional lets a missing `rng`
  compile silently and fail only when a tick happens to need one, which is
  exactly the "fails open" shape ADR 0001 already rejected once for the
  purity guard. Escalated to the human; mandatory was the explicit choice.
- **A third parameter on `step`** (`step(state, action, rng)`). Rejected
  because it would make `rng` required on every call regardless of action
  type — including `direction`, `pause`, `resume` and `restart`, none of
  which ever need one — which is a worse-shaped API than requiring it only
  on the one action variant that actually consumes it.
