# 0005. Scoped test environment: default to `node`, opt in to `jsdom`

Date: 2026-08-26
Status: Accepted

## Context

`vitest.config.ts` set `environment: 'jsdom'` globally from the #2 scaffold
onward, so every suite — including the pure logic layer's own — ran with
`window`, `document` and `localStorage` defined. DOM purity was enforced
only *statically*: the ESLint allow-list and the import-boundary suite
(both from ADR-0001) forbid a logic file from *referencing* those globals
in its source text. Neither says anything about what the test runner
itself hands that file's tests at execution time. Nothing stopped a logic
test from leaning on a DOM global if it wanted to, and nothing would have
failed if it had.

The misconfiguration survived four merged tickets (#2, #3, #5, #4). It was
found by the testing pass on ticket #5, while investigating a per-file
`// @vitest-environment jsdom` pragma on `keyboard.integration.test.ts`
that everyone had assumed was redundant — it turned out to be the only
thing standing between the suite and a silent regression, because removing
it would have changed nothing (every suite was already `jsdom`).

ADR-0001 already carries a corrected bullet about this in its Consequences
section, and the opt-in convention itself is documented in a comment in
`vitest.config.ts`. Neither is where a developer about to write a canvas
test for #6 will think to look. This ADR is the first-class, indexed
answer to "how do test environments work in this repo and why" — it
references ADR-0001's correction rather than restating it.

## Decision

**Global default `node`; a file that genuinely needs a DOM opts in per
file** with a `// @vitest-environment jsdom` docblock pragma. See
`src/input/keyboard.integration.test.ts` for the worked example: it
dispatches a real `keydown` event against `document` and carries the
pragma; every other test file in the repo does not.

This was measured, not assumed, before it was implemented: all five test
files that existed at the time already passed under `node`, because the
one file that needed a DOM already carried the pragma. The change to
`vitest.config.ts` was close to free.

The convention documented alongside the pragma deliberately says it
belongs on the **first line** of the file, although Vitest itself accepts
it lower down. That is a rule slightly stricter than strictly necessary,
chosen because it is impossible to misread, over a precise rule that would
require judgement about how far down is still "early enough". #6 and #7
both need to add DOM-touching test files later; the point of the stricter
wording is that they can follow it without having to think about it.

**A runtime guard makes the property true, instead of true by accident.**
Before #13, "the logic layer is testable without a DOM" was true only
because of how `vitest.config.ts` happened to be configured. Nothing
would break if that stopped being the case. `tests/logic-environment.test.ts`
turns that same claim into something that actually fails when it stops
holding: it asserts `typeof window`, `typeof document` and
`typeof localStorage` are all `'undefined'` at runtime.

The guard is deliberately **mechanism-agnostic**: it observes actual
runtime state rather than reading the `environment` field out of the
resolved Vitest config, which matters and isn't just tidier. It was
empirically confirmed to go red under three different regression routes —
a flipped global default, a `setupFiles` hook that assigns
`globalThis.window`, and a CLI `--environment=jsdom` override — and it
would equally catch a future `environmentMatchGlobs` misconfiguration that
handed this file a DOM by a fourth route nobody has tried yet. None of
those routes require touching the `environment: '...'` string the sensor
happens to sit near, which is exactly the point of asserting on state
instead of on config.

## Consequences

- The logic layer's DOM purity is now enforced two ways that were
  previously one: statically, by the ADR-0001 allow-list and the
  import-boundary suite (referencing a DOM global in `src/logic` source
  text is a lint error), and now also at runtime, by this ticket's guard
  (running with a DOM present is a test failure). See ADR-0001's
  Consequences section for the corrected account of what changed there;
  it is not restated here.
- The suite got measurably faster as a side effect: about 25–30% faster
  wall-clock (roughly 1.22s down to ~1.0s), and Vitest's own `environment`
  setup phase dropped four- to fivefold (roughly 1.89s down to ~0.37s),
  because one of six test files now pays the `jsdom` startup cost instead
  of all six. Worth recording as a pointer for later, though unrelated to
  this change: the current dominant cost in the suite is a single test in
  `tests/import-boundary.test.ts` that spends 480–700ms instantiating
  ESLint — that is the real bottleneck if anyone revisits suite speed.

### Known, accepted limitations — not forgotten defects

- **The ESLint allow-list reaches only `src/logic/**`.** Verified in
  review: a `jsdom` pragma plus a `window` reference inside
  `src/logic/game.test.ts` produces five lint errors; the identical
  pragma-plus-reference combination inside a file under `tests/**` —
  including `tests/import-boundary.test.ts` and this ticket's own guard —
  produces zero. So the framing "the allow-list catches usage and the
  runtime guard catches the environment, covering each other's blind
  spots" is true for `src/logic/**` and **not** repo-wide. This
  correction came out of review challenging a claim made too broadly at
  first; it was checked rather than taken on trust, and it did not
  survive being checked at full width.
- **A stray pragma on a logic test file is not detected.** The sensor
  watches the single global default, so giving one file its own `jsdom`
  pragma goes unnoticed by it. Accepted: that requires a deliberate,
  two-step act by a contributor, not a silent regression, and defending
  against deliberate acts by enumeration is precisely what ADR-0001
  argues against.
- **A test file dropped from `include` stops running silently** — exit
  code 0, no warning. This is repo-wide and pre-existing, not introduced
  by this ticket. Accepted for the same reason as above: any cheap guard
  against it would be exactly the enumerate-forever machinery ADR-0001
  rejects. Note honestly that this is the same shape of problem as the
  one this ticket fixes, one level up.
- The sensor itself has a latent placement risk: it lives under `tests/`,
  so whoever introduces per-directory environment scoping
  (Vitest's `environmentMatchGlobs`) must relocate it into `src/logic/`
  or add an equivalent sensor there, or the sensor could end up watching
  a different glob than the one it exists to guard.

### Process observation

This defect was introduced by the same ticket (#2) that wrote ADR-0001
asserting the opposite of what was actually configured, and it was not
caught by review or testing of the ticket that introduced it — it was
found incidentally, two tickets later, while working on something else.
See ADR-0004 for the related lesson recorded there: a test that stays
green when the rule it names is deleted is worse than no test at all.
This is a variant of that same shape, one level up — a *configuration*
that stayed green while asserting the opposite of what was true.
