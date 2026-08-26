# 0001. Toolchain, layer boundary and logic-purity guard

Date: 2026-08-25
Status: Accepted

## Context

Issue #2 scaffolds the project (Vite, strict TypeScript, Vitest, ESLint) and
sets up the one-way architectural boundary that issue #1's spec calls for:
`src/logic` must be pure game logic, free of the DOM, randomness and the
clock, so it can be tested and later re-skinned without touching a single
test.

The first attempt at enforcing "logic stays pure" was a deny-list: a
handful of named globals (`window`, `document`, `Math.random`, `Date.now`,
`performance.now`) forbidden via `no-restricted-globals` /
`no-restricted-properties`. Stage-6 review showed this empirically
insufficient: five plausible one-liners slipped through with zero lint
signal — `new Date().getTime()`, `crypto.getRandomValues(...)`,
`globalThis.Math.random()`, `setTimeout(...)`, `localStorage.getItem(...)`.
The root cause was structural, not a missing entry: `typescript-eslint`'s
`recommended` config disables `no-undef` project-wide (TypeScript's own
checker covers undefined-variable errors), so the two narrow deny rules
were the *only* guard, and they only ever match the exact spellings someone
thought to enumerate in advance.

A second review round, after the fix described below, found two further
gaps of a different class: Node built-in imports (`node:crypto`, bare
`crypto`, `node:perf_hooks`, ...) bypass global-scope rules entirely
because they're module-scoped bindings, not global references, so
`no-undef` never sees them; and the `files` globs in the original config
only matched `.ts`, so `.mts`/`.cts` files under `src/logic` matched no
purity config block at all and had no guard whatsoever.

## Decision

**Three-layer architecture, one-way dependency.** `src/logic` is pure: it
imports nothing of ours, and must not touch the DOM, randomness or any
clock. `src/input` and `src/renderer` may import from `src/logic`; `logic`
may import from neither, nor from `src/persistence` or the composition
root (`src/main`). Randomness is injected into logic as an `rng: () =>
number` parameter; time is not injected at all — logic has no notion of
time and the caller decides when a tick happens.

**The import boundary is expressed structurally, not enumerated.**
`eslint-plugin-import`'s `no-restricted-paths` zone reads "`src/logic` may
not import from anything outside `src/logic`" (`from: './src', except:
['./logic']`), not a list of today's four sibling directories. An
enumeration doesn't self-maintain: the first shared module a later ticket
adds (e.g. a hypothetical `src/shared`) would silently open an indirect
route from logic into input or renderer unless someone remembered to add
it to the list. Fixed while the codebase is at its smallest, so nobody has
to remember.

**The purity guard is an allow-list, not a deny-list.** `no-undef` is
re-enabled for `src/logic/**/*.{ts,mts,cts}` with a minimal, explicit set
of granted globals (`Array`, `Object`, `Math`, `Number`, `String`,
`Boolean`, `Map`, `Set`, `JSON`, `Symbol`, `undefined`, `NaN`, `Infinity`).
`globalThis` is explicitly revoked despite `languageOptions.ecmaVersion`
granting it by default, because it's a generic escape hatch back to every
other global. Anything not granted — `crypto`, `localStorage`,
`sessionStorage`, `navigator`, `fetch`, `setTimeout`, `setInterval`,
`requestAnimationFrame`, `window`, `document`, and anything invented later
— is a lint error by default, with no extra work required to keep it that
way. `Date`, `window` and `document` additionally get explicit
`no-restricted-globals` entries for a clearer message, because
typescript-eslint's scope manager resolves `Date` from the TS lib types
regardless of what `languageOptions.globals` says, so revoking it via
globals alone doesn't work. `Math.random` gets an explicit
`no-restricted-properties` entry for the same reason: `Math` itself must
stay allowed for `Math.floor` etc. `import/no-nodejs-modules` closes the
Node-built-in route, which is module-scoped and invisible to `no-undef`.
The `files` globs for both the import-boundary and purity blocks cover
`.ts`, `.mts` and `.cts` so no file extension escapes either guard.

**Known and accepted ceiling.** `.constructor`-based runtime reflection
(e.g. `Array.constructor("return globalThis")()`) still escapes this
guard and is deliberately not fixed. Closing it would mean banning
`.constructor` property access generally, which costs far more (in
legitimate code flagged) than it buys, and it requires deliberately
obfuscated code that nobody writes by accident. This is lint-based
enforcement, not a sandbox; that's a known limit, recorded here so it
isn't rediscovered later as a surprise defect.

**No runtime dependencies.** Vanilla TypeScript, Canvas 2D, no game
engine, no UI framework, no state management library. All dependencies in
`package.json` are dev-only (toolchain).

**High TypeScript strictness as the repo default.** `strict: true` plus
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`,
`noUnusedParameters`, `noFallthroughCasesInSwitch`. Chosen now, while
there's no code to migrate, rather than tightened later against an
existing codebase.

**Test layout convention.** Colocated unit tests as `src/*.test.ts`
next to the code they test; cross-cutting architecture tests (currently
just the import-boundary/purity suite) under `tests/**`, since they don't
belong to any single module. That suite lints representative code
snippets against the *real* `eslint.config.js` via ESLint's Node API
(`overrideConfigFile`), rather than against a copy of the rules — so it
fails automatically if the actual config regresses. That technique is why
the deny-list gaps above were provable rather than debatable, and it's why
future changes to this guard should extend that same suite rather than
re-deriving trust in the config by inspection.

## Consequences

- The reducer that later tickets write is testable without timers or
  flakiness, and the visual presentation can change later without
  touching a single logic test — that's the payoff of the layer boundary.
  **Correction (#13):** this bullet originally also said "without ...
  jsdom", framing jsdom as something avoided. That was misleading rather
  than strictly false — the reducer's tests never *needed* jsdom, but
  `vitest.config.ts` defaulted every suite to `jsdom` regardless, so it
  simply ran inside one, unused, until #13 scoped the test environment.
  DOM purity is enforced statically, by the ESLint allow-list guard and
  the import-boundary suite described above, and — since #13 —
  additionally by the test environment itself: `vitest.config.ts` now
  defaults every suite to `node`, so the logic layer's own tests run with
  no DOM present, and a dedicated runtime check
  (`tests/logic-environment.test.ts`) fails if that ever regresses.
- Anyone tempted to "simplify" the purity guard back into a deny-list
  should read this ADR first: a deny-list must be extended for every
  newly invented route to impurity and therefore fails open by
  construction; this allow-list fails closed, including against routes
  nobody has thought of yet.
- The `.constructor` reflection ceiling is a known, accepted gap in
  lint-based enforcement, not an oversight — see "Known and accepted
  ceiling" above.
- `npm test`, `npm run typecheck`, `npm run lint` and `npm run build` are
  now the contract every later ticket must keep green; there is no
  runtime dependency to fall back on if strictness or lint rules make
  that inconvenient.
