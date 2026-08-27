# 0009. Documentation claims are falsifiable too: three prose absolutes corrected, and the platform-ownership model they obscured

Date: 2026-08-27
Status: Accepted

## Context

Issue #8 (the project README) does not, by itself, decide anything —
a README describes what already exists. It earns an ADR anyway because
writing it cost three review rounds, and none of the three were about
code. All three were the same shape: an absolute claim in prose,
contradicted by the repo it described.

1. "Mentioning the pragma token in a comment turns it into the pragma
   itself, regardless of surrounding text." False:
   `tests/logic-environment.test.ts` mentions `@vitest-environment` with
   no environment name after it, runs under the `node` default, and
   self-guards with `typeof window === 'undefined'`. Vitest matches the
   token **followed by an environment name**; a negation in front of it
   does not protect, but the absence of a name that follows does.
2. "The clock, randomness and the DOM are only ever wired in `main.ts`."
   Backwards for the DOM part: `src/renderer/canvas.ts` reads
   `window.innerWidth`/`innerHeight`/`devicePixelRatio` and drives
   `CanvasRenderingContext2D` directly, and `src/persistence/index.ts`'s
   default storage touches `localStorage` directly — both more directly
   and more often, for these concerns, than `main.ts` does.
3. "`src/test-support/` is shared by renderer tests." The module's own
   docblock, and `src/main.test.ts`'s actual use of it
   (`vi.spyOn(HTMLCanvasElement.prototype, 'getContext')`), say
   composition tests use it too.

This is the eighth instance of a failure class this project has been
tracking since ADR-0001: a load-bearing claim that looks true, was not
checked against the thing it describes, and shipped anyway. The first
seven: ADR-0001 (a purity guard bypassable with zero lint signal),
ADR-0002 (an acceptance criterion with no test at all), ADR-0004 (an
occupied-cell test that stayed green with its own filter disabled),
ADR-0005 ("the logic layer needs no DOM" was true only by test-runner
default, for four merged tickets, until a runtime guard made it true by
construction), ADR-0007 §3 and §4 (a clamp test unreachable at today's
constants, and an algebraic tautology that could not fail), and
ADR-0008 §7 (an AC6 test whose first draft short-circuited past the
code path it existed to exercise). Every one of those seven lived
inside a test. This is the first to live entirely in prose, with no
test able to catch it either way.

## Decision

Treat an absolute claim in documentation the same way this project
already treats an absolute claim a test makes: falsify it against the
repo before it ships, not after review finds it. Concretely, scan prose
for `only`, `never`, `all`, `exactly`, `every` and `the one` before
committing, and check each one with a grep or a run — not against
memory or a plausible mental model of how the code must work.

The corollary this ADR exists to put on record: **a documentation claim
that the repo itself contradicts is worse than no documentation at
all** — it ships with the authority of having been written down.

## Consequences

- The damage was not hypothetical. Claim 2, left uncorrected, could have
  sent a future contributor to move canvas handling out of `renderer`
  and into `main.ts` — the exact layer split AC4 exists to protect.
  Claim 1 could have sent someone to "fix" one of this project's two
  runtime guards.
- This ticket made explicit a platform-ownership model that no ADR had
  stated before: `renderer` owns the canvas, `persistence`'s default
  implementation owns `localStorage`, `input` owns the `EventTarget` it
  binds to, and `src/logic` is the one layer whose purity is
  mechanically enforced — the `eslint.config.js` allow-list, not
  convention (see ADR-0001, ADR-0006, ADR-0008). See `README.md` for
  what each layer does; this ADR does not restate it.
- The README states two conventions as deliberately stricter than
  technically necessary — both already decided by ADR-0005, repeated
  there and not here beyond this pointer: the jsdom pragma belongs on
  line 1 even though Vitest itself accepts it lower, and the pragma
  token should not appear in a comment at all, even negated, because the
  one safe exception (`tests/logic-environment.test.ts`) is too subtle
  a rule to generalise from.
- Rejected: adding a Node `engines` minimum. There is no `.nvmrc`, no
  `engines` field in `package.json`, and only Node 24 has actually been
  run against this project. A version floor would itself be exactly the
  kind of unchecked claim this ADR is about; the README states the
  checked fact instead — developed and tested on Node 24.
- Accepted, not fixed: `src/composition/loop.ts:89-90` falls back to the
  bare `requestAnimationFrame`/`cancelAnimationFrame` globals when
  `startTickLoop` isn't given explicit ones. That path is unreachable
  today — `main.ts` is `startTickLoop`'s only production caller and
  always supplies both explicitly, as does every call in
  `loop.test.ts` — so the README says "only here in practice" rather
  than "only here." Removing the dead fallback would be a behaviour
  change, and a README ticket is the wrong place to make one; recorded
  here as a known, named limitation rather than a defect.
