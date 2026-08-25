# Architecture Decision Records

This directory holds ADRs for `cyberpunk-snake`: short records of decisions
that are expensive to reverse or easy to accidentally undo, and the
reasoning behind them. They are not design docs and not a changelog — see
`docs/release-notes/` for user- and contributor-facing changes per ticket.

## When to add one

Add an ADR when a ticket introduces or changes a decision that constrains
future work — an architectural boundary, a strictness default, a tooling
choice with no runtime dependency, a deliberately accepted limitation. Not
every ticket needs one; scaffolding, boundary and strictness decisions
usually do, routine feature/content changes usually don't.

## Numbering and file naming

Sequential, zero-padded to four digits, never reused or renumbered even if
a later decision supersedes an earlier one: `NNNN-short-kebab-title.md`,
e.g. `0001-toolchain-and-logic-purity-boundary.md`. Superseding an earlier
ADR is itself a new ADR that says so and cross-links back; the old one
stays on record with its status updated (see template).

## Template

```markdown
# NNNN. Title

Date: YYYY-MM-DD
Status: Accepted | Superseded by NNNN | Deprecated

## Context

What situation forced a decision. What was tried first, if anything, and
why it wasn't enough.

## Decision

What was decided, stated plainly.

## Consequences

What this makes possible, what it costs, and what it deliberately does
not solve (known limitations, accepted ceilings).
```

Keep ADRs about decisions and their consequences, not about file listings
or step-by-step implementation detail — that belongs in the code and its
own comments.
