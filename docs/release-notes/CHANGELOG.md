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
