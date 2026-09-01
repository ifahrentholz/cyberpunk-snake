# 0011. Lockfile regeneration for npm-engine drift: a corrected diagnosis, an accepted 35-package delta, and a reversibility gap that does not block

Date: 2026-09-01
Status: Accepted

## Context

The first deploy run triggered by #9's merge (`541c051`) failed at the
first gate: `npm ci` exited `EUSAGE` — `Missing: @emnapi/core@1.11.3`,
`Missing: @emnapi/runtime@1.11.3` — before `Test`, `Typecheck`, `Lint`,
`Build`, or `Configure Pages` ran at all, and the `deploy` job never
started because it depends on `build` (`needs: build`). The workflow
itself behaved correctly: it stopped at the first failing gate instead of
publishing something broken. The defect was in the checked-in
`package-lock.json` (370 `packages` entries, carried unchanged since
#2), not in #9's workflow.

The originating issue (#22) diagnosed the cause as a Linux-portability
problem: the checked-in lockfile nests `@emnapi/core` and
`@emnapi/runtime` only under
`node_modules/@unrs/resolver-binding-wasm32-wasi/node_modules/`, never
promoting them to top level, and the issue's author reasoned this was
consistent on macOS/arm64 (where every prior gate run in this project
had executed) but would resolve differently on the CI runner's
linux/x64. **That diagnosis is corrected here — see §1.** The actual
cause is one dimension over: the npm version, not the operating system.

## Decision

### 1. The corrected root cause

The implementing agent, rather than accepting the platform explanation
from the ticket, fetched the exact Node version the CI runner used via
`nvm` and reproduced the failure locally. That result was reproduced a
second time, independently, against the unmodified checked-in lockfile,
both runs on macOS/arm64:

| Engine | `npm ci` against the old lockfile |
|---|---|
| node 24.19.0 / npm 11.17.0 (CI runner's version) | `EUSAGE` · `Missing: @emnapi/core@1.11.3` · `Missing: @emnapi/runtime@1.11.3` — byte-identical to the CI failure |
| node 24.12.0 / npm 11.6.2 (this project's local dev version) | succeeds — `added 319 packages` |

Both runs used the same operating system and CPU architecture; only the
npm version differed, and only the npm version changed the outcome.
That rules out the platform as the variable that matters here, though it
does not by itself prove linux/x64 would behave identically to
macOS/arm64 under npm 11.17.0 — see the limitation in the Consequences
section.

The mechanism: `@napi-rs/wasm-runtime` declares peer dependencies on
`@emnapi/core` / `@emnapi/runtime` (`^1.7.1 || ^2.0.0-alpha.4`). In the
old lockfile both existed only as nested copies under
`@unrs/resolver-binding-wasm32-wasi/node_modules/`, never as top-level
`node_modules/@emnapi/core` or `node_modules/@emnapi/runtime` entries.
npm 11.6.2's `npm ci` accepts that nesting as satisfying the peer
dependency; npm 11.17.0 validates peer dependencies more strictly and
does not. The dependency chain runs through `unrs-resolver` →
`eslint-import-resolver-typescript`, which is the toolchain the
import-boundary purity guard from #2 (ADR-0001) depends on — the reason
that guard needed explicit re-verification in §2 below, not just a
green test run.

Recording the wrong first diagnosis alongside the right one is
deliberate, not incidental: the lesson this ticket adds is not only
"the cause was the npm version" but "the way to find that was to obtain
a second toolchain version and test against it, rather than trust a
platform explanation that fit the available evidence but wasn't itself
checked."

### 2. Accepting a 35-package version delta instead of pinning

Regenerating the lockfile (`rm -rf node_modules package-lock.json && npm
install`, run under npm 11.17.0 — the CI engine) changed the `packages`
entry count from 370 to 369 and produced a diff of 232 insertions / 195
deletions across one file. Against a starting expectation of a
near-zero diff, the actual result was:

- **2 packages added** at top level: `@emnapi/core@1.10.0`,
  `@emnapi/runtime@1.10.0`.
- **3 packages removed**: the three nested duplicates under
  `@unrs/resolver-binding-wasm32-wasi/node_modules/` (`@emnapi/core`,
  `@emnapi/runtime`, `@emnapi/wasi-threads`), superseded by the
  top-level entries above.
- **35 packages with a changed version, and no major-version jump among
  them.** `eslint` (9.39.5), `typescript` (6.0.3), `vite` (8.2.2) and
  `vitest` (4.1.11) are unchanged. Exactly one of the 35 is mechanically
  forced rather than drift: `@emnapi/wasi-threads` moves 1.2.3 → 1.2.1,
  because `@emnapi/core@1.10.0` requires that exact version as its own
  dependency, and npm resolves it by hoisting the compatible version to
  top level rather than nesting a fourth copy. The other 34 are
  patch/minor re-resolutions within existing caret ranges — among them,
  16 packages from the `rolldown` family move in lockstep
  (1.2.5 → 1.2.6): the `rolldown` package itself plus all 15 of its
  `@rolldown/binding-*` platform variants, which npm's
  `optionalDependencies` resolution ties to one shared version.

The available alternative was a surgical fix: add only the two missing
top-level entries and pin the rest to their prior versions with
`--save-exact` (or hand-edited metadata). That was considered and
rejected. `--save-exact` would touch `package.json`, which the ticket's
AC2 requires to stay unchanged. More importantly, pinning would lock the
lockfile to the versions npm 11.6.2 happened to choose, while CI
validates that same lockfile with npm 11.17.0 — and that discrepancy
between the engine that wrote the lockfile and the engine that verifies
it is the defect this ticket exists to fix. Conserving it to keep the
diff small would trade a smaller diff for reintroducing the underlying
condition, in a different shape.

The cluster carrying the most risk was `@typescript-eslint/*`: 11
packages move together (the ten `@typescript-eslint/*` scoped packages
plus the `typescript-eslint` meta-package), 8.68.0 → 8.69.0 — the exact
toolchain the import-boundary purity guard from #2 (ADR-0001) is built
on. A separate, unrelated package, `ignore` (nested under
`@typescript-eslint/eslint-plugin`), also changes in this diff, 7.0.6 →
7.0.8; it is not part of the 8.68.0 → 8.69.0 cluster and does not carry
the same risk. This was checked empirically, not assumed: `tests/import-boundary.test.ts` — which drives ESLint's Node
API against real fixture code, per ADR-0001's own convention of testing
the actual config rather than a copy of its rules — is unchanged
byte-for-byte after the regeneration and stays green, still reporting
one violation for each of the ten cases #2 established (ten problems in
total), with a legitimate injected-`rng` fixture still producing zero
findings. The guard's strictness did not move in either direction.

### 3. The reversibility gap — measured, and why it does not block this ticket

The most important finding of this ticket is that the fix, once
committed, is not stable under a plain `npm install` run on this
project's own local npm version. Measured directly against the
regenerated lockfile (md5 `7a29230d6bc79aed9cd4bb01213442f2`):

| Action on the PR lockfile | Result |
|---|---|
| `npm install --package-lock-only` under npm 11.17.0 | no-op |
| the same command under npm 11.6.2 | 12 insertions / 83 deletions; the top-level `@emnapi/core` and `@emnapi/runtime` entries are removed |
| that reduced lockfile, then `npm ci` under npm 11.17.0 | `EUSAGE` — `Missing: @emnapi/core@1.11.3 from lock file` — the original defect, reproduced |

This was independently reproduced while writing this record, in a
throwaway directory, against the exact lockfile that shipped in this
PR. A local `npm install` run under this project's own dev-engine
version (11.6.2) silently takes the fix back.

The natural instinct was to treat this as a violation of ADR-0001's
fail-closed stance ("an allow-list fails closed, including against
routes nobody has thought of yet") — this ticket asked that question of
itself before deciding otherwise. The resolution: **this is a
precisization of ADR-0001, not a departure from it.** Reversibility here
is not a deployment-safety problem, it is a toil problem. Running `npm
install` locally does not change what `main` or CI see — nothing is
published by that action alone. Publishing requires someone to commit
and push the reduced lockfile; at that point, the same `npm ci` step in
the unmodified deploy workflow runs against it and fails closed again,
exactly as it does today, before any deploy step executes. There is no
path measured here on which a reduced lockfile reaches a real deploy.
ADR-0001's fail-closed argument describes a situation where one guard is
the only defense; here a second, independent, already-effective guard
(the `npm ci` gate itself) exists. What stays open is not protection
against a bad release — it is protection against the next contributor
re-discovering this same confusion by running a routine `npm install`
locally and wondering why the top-level `@emnapi/*` entries vanished.

No acceptance criterion on #22 asks for resilience against future
engine drift; adding that resilience here would be a new, eighth
criterion this ticket was not scoped to satisfy. It is recorded below,
under Consequences, as an open decision rather than settled by this
change.

### 4. Options considered for closing the reversibility gap (not decided here)

One option was measured directly rather than only reasoned about:
`engines: { node: '>=24.19.0', npm: '>=11.17.0' }` in `package.json`
plus `.npmrc` with `engine-strict=true`. Under npm 11.6.2, that
combination makes `npm install` fail with `EBADENGINE` and leaves the
lockfile untouched — it works, as a fail-closed guard against exactly
the regression in §3. But it also fails `npm ci` under any npm below
11.17.0, which would lock out this project's own local development
engine (11.6.2) from the plain install-and-run workflow this project
documents. That trade-off is not this ADR's to accept unilaterally, so
it is left open rather than adopted:

| Option | Effect |
|---|---|
| `engines` + `.npmrc engine-strict=true` | Fails closed (measured, §above); blocks `npm ci`/`npm install` on any npm below the floor, including this project's own dev engine today |
| `engines` alone, no `engine-strict` | A warning only, easy to scroll past — not fundamentally different from the absence of any engine signal at all, which is the condition under which this defect actually shipped |
| `.nvmrc` alone | Cheap to add; does nothing against someone who ignores it |
| `packageManager` field + Corepack | Fails open, silently, if Corepack isn't active in the environment that runs the install; Corepack's place in future Node releases is not settled |
| A CI check for lockfile drift | Fails closed, but redundant with what `npm ci` already does today; needs pull-request-triggered CI to run before merge, which this project does not yet have |
| Pin `node-version` to an exact patch in the deploy workflow | Closes the CI-side half of the drift vector (the npm version that ships with a floating `node-version: '24'`); does nothing for a local install |

No option here is adopted by this ticket. Pinning `node-version` to an
exact value plus adding `.nvmrc`, without committing `engine-strict`,
is the shape that best matches what was measured — but that is a
recommendation to record, not a decision this ADR makes on the human
maintainer's behalf.

### 5. The systemic lesson

This defect survived nine merges (#11 through #21, following the
lockfile's introduction in #10/#2), a green test suite, and the reviews
that accompanied each of those tickets — not through neglect, but
because each of those gate runs executed under whatever local npm
version the developer's machine had installed, which for this project
has so far always stayed below the threshold where npm's stricter
peer-dependency validation (introduced by npm 11.17.0) applies. Framing
that as "nine merges unnoticed on macOS," as the originating issue did,
overstates what was actually shown: the reproduction in §1 held the
platform fixed and varied only the npm version, and that was sufficient
to reproduce the failure. The gap this ticket closes tracked npm-version
drift, not operating-system drift; nothing measured here rules out the
possibility that a macOS runner on npm 11.17.0 would have failed just
as the linux/x64 runner did.

The general form: a green run demonstrates correctness relative to the
toolchain that produced it. Nine merges of green gates said nothing
about a different npm version, because none of those runs used one.
This project has been tracking a related but distinct failure class
since ADR-0001 — a load-bearing claim that looks true, isn't checked
against the thing it describes, and ships anyway; ADR-0009 names eight
prior instances of it inside code, tests, and prose, and ADR-0010
applies the same falsifiability standard to a deployment. This ticket
extends that lineage into a dimension none of those eight named
explicitly: the toolchain version itself, which every one of those
"green" runs was implicitly measured against without saying so.

## Consequences

- The deploy workflow can now get past its first gate; whether the
  actual deploy and the published page work is unverified by this
  ticket and only observable after `main` picks up this change and the
  workflow runs for real (see AC7 of #22).
- Known limitations, stated rather than smoothed over:
  - **No real linux/x64 execution.** Docker was unavailable in the
    sandbox used for this work. The reproduction in §1 establishes npm-
    version parity, not platform parity; that the peer-dependency
    validation involved is platform-independent is inferred from both
    affected packages' lockfile entries having `os`/`cpu` set to
    `undefined`, not directly observed on linux/x64. AC5 of #22
    explicitly permits stating this rather than claiming a proof that
    doesn't exist, and the npm-engine-parity method used here targets
    the actual failure mechanism more directly than simulating platform
    flags on an unchanged lockfile would have (an earlier probe in the
    issue itself found the `--os`/`--cpu` flags made no difference to
    the outcome). A real linux run remains the one fully conclusive
    check this ticket does not perform.
  - **The reversibility gap in §3 is left open, deliberately**, on the
    reasoning given there.
  - **`node-version: '24'` in the deploy workflow still floats**, and
    the npm version that ships with it floats along with it — the
    drift vector that caused this defect is not closed by this ticket.
  - **This project still has no pull-request-triggered CI.** Every gate
    for every ticket to date, including this one, was run by hand
    before merge. That is a known gap, not a decision this ADR makes;
    it belongs to the human maintainer.
  - **AC7 of #22** ("the deploy workflow completes and the page is
    reachable after merge") is only observable once `main` has run the
    workflow again, which had not happened as of this record.
