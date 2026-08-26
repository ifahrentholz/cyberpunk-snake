# 0003. Keyboard input binding: pure mapper, thin DOM seam, two input guards

Date: 2026-08-26
Status: Accepted

## Context

Issue #5 builds the keyboard layer on top of the reducer ADR 0002 fixed:
`step(state, action)` is the only way to change `GameState`, and the
logic layer (off limits to this ticket) exposes separate `pause` and
`resume` actions with no toggle. Space is expected to toggle pause/resume
from the player's point of view, so something outside `src/logic` has to
own that decision. Nothing yet drives this layer — #6 (tick loop and
renderer) is what will call `bindKeyboard` for real — so every decision
below was made and verified without a running game to observe.

## Decision

**Two-part shape: a pure mapper plus a thin DOM seam.**
`keyToAction(key, status): GameAction | null` knows nothing about the DOM.
`bindKeyboard` is the only part of this file allowed to touch
`EventTarget`/`KeyboardEvent`; it attaches a `keydown` listener and returns
an unbind function. `keyToAction`'s signature was deliberately **not**
widened to accept a `KeyboardEvent` — modifier and repeat handling live in
`bindKeyboard`'s `handleKeyDown` instead, specifically so the mapper stays
free of DOM types and testable as plain data in, plain data out.

**The pause/resume toggle decision lives in the input layer, not the logic
layer.** `keyToAction` emits `resume` when `status === 'paused'` and
`pause` for every other status — including `ready` and `over`, where
`step` already treats `pause` as a no-op. This borrows a correctness
guarantee from another module (that `step` ignores `pause` outside
`running`) rather than re-deriving it here; review verified today that the
guarantee holds, by reading `advance`/`step` in `src/logic/game.ts`. The
alternative — returning `null` for `ready`/`over` so this file never
depends on that guarantee — was rejected: it would drop
`preventDefault()` for Space on those statuses and let the key scroll the
page on the start screen. That's a visible regression in feel, traded away
here in favour of decoupling something that already works. The dependency
is honest, not hidden: it's recorded here, and the question of whether it
actually feels right is routed to #6, where the game first becomes
playable and the behaviour is observable rather than inferred from code.

**Two input guards in `bindKeyboard`, each preventing a specific,
concretely demonstrated failure — not a generic "be safe" gesture:**

- **Modifier guard** (`ctrlKey || metaKey || altKey`). Without it,
  `Cmd/Ctrl+R` maps to `restart` *and* calls `preventDefault()`,
  swallowing the browser's reload shortcut. Likewise `Cmd/Ctrl+W` → up,
  `Ctrl+A` → left, `Cmd+S` → down — ordinary browser shortcuts colliding
  with WASD/R bindings. The guard bails out before calling
  `preventDefault()` at all, because suppressing the browser's own
  shortcut is precisely the harm being avoided, not a side detail.
  `shiftKey` is deliberately **excluded** from this guard: no browser
  shortcut collides with Shift+Arrow or Shift+letter, and guarding it
  would only take control of the snake away from a player who happens to
  be holding Shift, for no corresponding benefit.

- **Repeat guard** (`event.repeat`). OS key-repeat re-fires `keydown`
  while a key stays held. That's harmless for directions and restart —
  re-queuing the same value repeatedly is idempotent — but not for Space:
  `keyToAction` recomputes the pause/resume toggle from the *live*
  `getStatus()` on every event, so a held space bar produces an
  alternating `pause`/`resume` burst whose final state depends on the
  parity of how many repeats fired before release. One press must be one
  toggle. Repeats are ignored uniformly for every bound key, not just
  Space, because one rule that applies everywhere is easier to reason
  about — and to keep correct under future edits — than a special case
  carved out for one key.

**The architectural insight the review produced, and the reason it's
recorded here rather than left implicit in the diff.** The 34 unit tests
in `keyboard.test.ts` drive a hand-built `FakeEventTarget` whose
`addEventListener` ignores the event-type string entirely and whose
`dispatchEvent` fires every registered listener regardless of what type
was passed to `dispatchEvent` or `addEventListener`. The reviewer proved
what that means empirically, not just by inspection: changing the real
registration in `bindKeyboard` from `'keydown'` to `'keyup'` in a scratch
copy left **all 34 `FakeEventTarget`-based tests green**, and failed only
the one jsdom integration test in `keyboard.integration.test.ts`. Fake-event
tests of this shape structurally cannot verify *which* event type gets
bound — they can only verify what happens once *some* event reaches the
listener. That is the concrete reason issue #5's "exactly one integration
test against a real DOM" requirement carries real weight rather than being
a formality someone could reasonably delete as redundant coverage.
Anyone later tempted to remove `keyboard.integration.test.ts` because "the
34 unit tests already cover keyboard handling" should read this paragraph
first: they cover the mapping and the guards, not the wiring to the
correct DOM event.

**Known residual boundaries, accepted as limits rather than forgotten
defects:**

- On Windows and some European keyboard layouts, pressing AltGr is
  reported by the browser as `ctrlKey: true, altKey: true` on the
  `KeyboardEvent`. Because AltGr sits directly beside the Space bar on
  those layouts, an accidental AltGr+Space is caught by the modifier
  guard and silently drops the pause keypress. Judged negligible: no
  layout maps AltGr combined with arrows, WASD, R or Space to anything a
  player would intentionally produce, and this game accepts no typed
  text, so there's no scenario where a player is deliberately holding
  AltGr while trying to play.
- No `isComposing` guard and no focused-element/`contentEditable` guard.
  Unreachable today — there is no `<input>`, `<textarea>` or
  contenteditable element anywhere in the codebase or in this ticket's
  scope, so there is nothing for IME composition or text-field focus to
  interact with. This becomes relevant only if a text field (e.g. a
  player name entry) is ever added to the game.

**The `// @vitest-environment jsdom` pragma in
`keyboard.integration.test.ts` is currently redundant** — `vitest.config.ts`
already sets `environment: 'jsdom'` globally for every test file, so every
test in this codebase runs under jsdom today, whether it touches the DOM
or not. That global default is a pre-existing condition from #2, tracked
as its own defect under issue #13, and fixing it is **not** this ticket's
doing or this ADR's decision. The pragma was kept here deliberately anyway:
it documents this specific file's real requirement independent of the
global config, and it becomes load-bearing rather than decorative the
moment #13 flips the global default to `'node'`. See #13 for the tracked
fix; this file is the reason that fix must not simply flip the default and
walk away.

## Consequences

- `keyToAction` is fully exercised as pure data-in/data-out — no DOM, no
  fake target even — while `bindKeyboard`'s guards and wiring have their
  own coverage, including the one jsdom-backed integration test that is
  the only thing in the suite capable of catching a wrong event-type
  regression.
- #6 can call `bindKeyboard({ target: window, getStatus, dispatch })`
  (or `document`) directly once the tick loop and renderer exist, with no
  renegotiation of `GameAction` or `GameState`.
- The pause/resume-while-not-running behaviour and the two AltGr/IME
  limitations above are places worth a second look once #6 makes the game
  observable — this ADR states the current reasoning and evidence, not a
  guarantee that it will still look right once there's a screen to watch.

### Explicitly rejected

- **Returning `null` from `keyToAction(' ', status)` for `status !==
  'running' | 'paused'`**, to avoid depending on `step` ignoring `pause`
  outside `running`. Rejected because it reintroduces a real, visible
  regression (Space scrolling the start screen) to avoid a coupling that
  was checked and confirmed correct, rather than assumed.
- **A separate repeat-guard carve-out for Space only**, leaving directions
  and restart free to re-fire on OS key-repeat. Rejected in favour of one
  uniform repeat guard for every bound key: a single rule applied
  everywhere is less to get wrong later than a rule with an exception
  memorised alongside it.
- **Guarding `shiftKey` alongside `ctrlKey`/`metaKey`/`altKey`.** Rejected
  because no browser or OS shortcut this game's bindings could collide
  with uses Shift alone, so the guard would have no corresponding failure
  to prevent — only a cost to a player holding Shift incidentally.
