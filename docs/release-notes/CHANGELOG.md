# Release Notes

Format loosely follows [Keep a Changelog](https://keepachangelog.com/).
Entries are grouped under `## Unreleased` until a version is cut; each
ticket appends one entry here, referencing its issue number. See
`docs/adr/` for the reasoning behind a change; this file is for what
changed and, where relevant, why it matters to someone running or
contributing to the project — not the reasoning itself.

## Unreleased

### Added

- Project scaffold: Vite, strict TypeScript, Vitest, ESLint (#2). No
  user-visible behaviour ships with this ticket — there is no game yet.
  This lays the toolchain and the architectural guard rails (see
  `docs/adr/0001-toolchain-and-logic-purity-boundary.md`) that every
  later ticket builds on.
- Four canonical commands, now the contract every later ticket must keep
  green: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
- Core game reducer (#3): `createGame`/`step` implement the full snake
  mechanics — movement, direction queuing with the 180°-reversal guard,
  wall and self-collision, pause/resume, restart — as a pure, fully
  tested state machine (54 tests total: 23 in `game.test.ts`, 1 in
  `main.test.ts`, 30 in `tests/import-boundary.test.ts`). **Nothing is
  playable yet**: there is no renderer and no tick loop driving this
  reducer, so there is still no game to look at or play until #6 lands.
  See `docs/adr/0002-core-reducer-contract.md` for the reasoning,
  including a pause-buffering bug (AC11) found and fixed during review
  and the `initialSnakeLength` config addition needed to make
  self-collision (AC8) reachable through the public API at all.
