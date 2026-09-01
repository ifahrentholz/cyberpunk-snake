# 0010. GitHub Pages deployment: a base-path deviation, a redirect-dependent asset resolution, and the evidence boundary between them

Date: 2026-09-01
Status: Accepted

## Context

Issue #9's AC1 reads, literally: "Vite `base` config is set to the
repository's Pages path" — for this repo, `/cyberpunk-snake/`. The merged
change instead leaves `vite.config.ts`'s `base: './'` untouched. AC2 asks
only for `npm run build` to run in CI; the added `.github/workflows/deploy.yml`
runs `npm test`, `npm run typecheck` and `npm run lint` ahead of it. Both
departures, and the workflow's remaining shape, are decisions this ADR
records — including the case against each one, not only for it.

## Decision

### 1. `base` stays `'./'`, not `/cyberpunk-snake/`

Vite rewrites `index.html`'s root-absolute `<script src="/src/main.ts">` to
a relative `./assets/index-*.js` reference at build time — measured against
the built `dist/index.html`, independently reproduced by the coding agent,
the reviewer and this documentation pass. A relative reference resolves
correctly under whatever subpath it is served from, without naming that
subpath. Hardcoding `/cyberpunk-snake/` would break on a repo rename or a
fork, and would push the local dev server off `localhost:5173/` onto
`localhost:5173/cyberpunk-snake/` — a regression against the `npm run dev`
instructions #8's README gives.

That is the case for the chosen value. The case for AC1's literal wording
is just as real and belongs here, not only in review notes: an absolute
`base: '/cyberpunk-snake/'` would be immune to the failure mode in
Decision 2 below, because an absolute path is resolved against the
document's origin, not against whatever the browser currently believes the
directory to be — the trailing-slash question this ADR spends its next
section on would not arise at all. The review that raised this called it
the strongest argument for AC1's wording and did not retract it; it placed
the argument, rather than dismissing it. This ADR does the same: AC1 is met
in intent — assets resolve correctly under the Pages subpath — and not met
in the letter the acceptance criterion actually uses.

### 2. The relative path's dependency on the trailing-slash redirect

A relative URL resolves against the current document's path, so
`./assets/index-*.js` only reaches the right file if the browser believes
it is at `/cyberpunk-snake/` (with the slash), not `/cyberpunk-snake`
(without it). Stage 5 verified this locally: `dist/` served under
`/tmp/pages-sim/cyberpunk-snake/` via `python3 -m http.server`.

| Request | Result |
|---|---|
| `GET /cyberpunk-snake/` | 200, correct title; resolved `./assets/index-*.js` → 200, `text/javascript` |
| `GET /cyberpunk-snake` (no slash), redirect followed | 301 → `/cyberpunk-snake/` → 200 |
| Same asset path resolved against the un-redirected, slash-less base | 404 |

So correctness depends on the client following that 301. Browsers do, per
the navigation spec — that is not in question here. What a browser-only
test cannot rule out is a client that does not: `fetch` called with
`redirect: 'manual'`, or a redirect-swallowing proxy in front of the page,
would resolve the asset against the wrong parent directory and 404.

The review raised one more point about this that belongs in the record
rather than staying implicit: the README's own "play it live" link already
contains the trailing slash (`https://ifahrentholz.de/cyberpunk-snake/`),
so the one channel this project actually distributes never exercises the
redirect path at all. The link masks the edge case; it does not close it.

### 3. Four gates in the deploy workflow, not the one AC2 names

AC2 requires `npm run build` in CI. The `build` job in `deploy.yml` runs
`npm test`, `npm run typecheck`, `npm run lint` and `npm run build`, in
that order, before `deploy` (`needs: build`) publishes the artifact.
Reason: every one of this project's gates has so far run per-branch only —
after a merge to `main`, nothing has re-run them automatically; the
orchestrator ran them by hand after each of this project's nine prior
merges. Two branches that are each green in isolation can still merge into
a broken `main`, and a deploy step carries no gate of its own — it
publishes whichever artifact it is handed. No step has `continue-on-error`
or a conditional `if:`; a failing step fails the job, and a failed `build`
job means `deploy` does not run.

### 4. Rejected: scoping `permissions` per job

The review proposed narrowing `permissions` per job — `build` needing only
`contents: read`, with `pages: write` and `id-token: write` reserved for
`deploy`. The proposal is correct on its own terms and was not adopted, on
a risk asymmetry rather than a disagreement about the fix:

- Benefit today: not exploitable through any path this project has found —
  the review said so itself.
- Downside if the scoping is wrong: a broken first deploy to a public URL,
  discovered only by scoping it, not before.
- This workflow has not executed once. Whether `configure-pages@v5`, run
  inside `build`, needs a `pages` permission at that step is a question
  only a real run answers — this repo has no PR-triggered CI to rehearse
  it against (see §7).

Hardening a step that has never executed, at the one point in this project
where a mistake is publicly visible, is the wrong trade under ADR-0001's
fail-closed-but-verifiable stance: a guard that has not been exercised is
not yet known to guard the right thing. Once this repo has CI that
actually runs the workflow — see the known limitation in §7 — this
trade-off should be revisited.

### 5. What is measured, and what is trusted

This is ADR-0009's falsifiability standard applied to a deployment, and the
line has to be drawn precisely rather than rounded to either "verified" or
"unverifiable."

- **Measured, locally:** asset resolution under a subpath, including the
  trailing-slash boundary and its failure case (§2). That local server
  substitutes for GitHub Pages' own path handling, and it is the actual
  risk `base: './'` carries.
- **Not measured, but a reasoned analogy:** that GitHub's Pages CDN
  performs the same directory-to-trailing-slash redirect a local Python
  server does. That is long-documented, widely relied-upon behaviour of
  GitHub Pages — it has not been measured against this repo's own Pages
  deployment, because that deployment has not run yet (§7).

Neither "not testable" nor "it works" is an accurate label for AC3 ("the
deployed URL serves the game with working assets"); the truth splits
between those two categories, and this section is where that split is
recorded rather than smoothed over.

### 6. Environment facts this project did not know before this ticket

Established live during review, independently confirmed, and recorded here
because nothing else in the repo states them:

- The published URL is `https://ifahrentholz.de/cyberpunk-snake/`, not
  `ifahrentholz.github.io/cyberpunk-snake/` — the GitHub account carries a
  Pages custom domain that project sites inherit.
- That domain is fronted by Cloudflare, which redirects `http://` to
  `https://` and then passes the request through to GitHub's origin.
  Confirmed live: the `https://` request returns GitHub's `404` with an
  `x-github-request-id` header behind Cloudflare's `server: cloudflare`.
- The `github-pages` environment's only configured protection rule is a
  branch policy restricted to `main`; there is no `required_reviewers`
  rule, so a deploy proceeds without manual approval. `main` itself is not
  branch-protected.
- Pages was switched on for this repo (`build_type: workflow`) by the
  orchestrator as repository configuration, before this PR existed — this
  PR did not enable Pages.

### 7. Known limitations

- AC1 is met in intent, not in the literal wording it uses (§1).
- AC3 and AC4 are observable only after this branch merges and the
  workflow runs at least once — they are not observable from this branch.
- `permissions` in `deploy.yml` are broader than the minimum a per-job
  scope would allow (§4), accepted rather than fixed.
- This repository has no CI triggered on pull requests. Every gate run
  across this project's nine tickets — including the four in this
  workflow's `build` job — has so far been run by hand, once per merge, by
  the orchestrator. That is a gap worth closing, not a decision this ADR
  makes on its own: whether and how to add PR-triggered CI is for a human
  to decide, in a follow-up ticket.
- Nobody has loaded this game in a real browser yet; that limitation
  predates this ticket and is unchanged by it — see ADR-0006's own
  section on the point rather than a restatement here.

## Consequences

- The published URL now exists in the README (#9) and can be shared,
  before it necessarily resolves to anything — see the CHANGELOG entry for
  this ticket for how that is worded.
- Anyone revisiting `base: './'` should read §1 and §2 together: the value
  is correct for normal browser navigation and has one named, evidenced
  exception, not zero.
- The next ticket that touches `deploy.yml` inherits an unexercised
  workflow. Its first real run is the point at which §4 and §5's "not yet
  measured" items become measurable, and is worth treating as a checkpoint
  rather than a formality.
