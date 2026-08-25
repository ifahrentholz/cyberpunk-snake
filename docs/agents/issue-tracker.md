# Issue Tracker

## Tracker

GitHub Issues im Repository `ifahrentholz/cyberpunk-snake`.

CLI: `gh` (authentifiziert). Issues lesen mit `gh issue view <nr>`,
anlegen mit `gh issue create`.

## Referenz-Konventionen

- Im Text und in Commit-Messages: `#<nr>`
- Im Pull Request, um das Ticket beim Merge zu schliessen: `Closes #<nr>`
- Blocker-Beziehungen werden im Issue-Body als `Blocked by: #<nr>` notiert.

## Label-Vokabular

| Label | Bedeutung |
|---|---|
| `spec` | Spezifikationsdokument, kein Implementierungsticket |
| `ready-for-agent` | Triagiert, bereit zur Umsetzung durch einen Agenten |
| `feature` | Neue Funktionalitaet |
| `chore` | Setup, Build, Tooling, Deployment |
| `design` | Rein praesentationsbezogene Aenderung |
| `docs` | Dokumentation |

## Acceptance Criteria

Jedes Implementierungsticket traegt seine Acceptance Criteria als
Markdown-Checkliste im Issue-Body. Diese Checkliste IST der
Akzeptanzvertrag, gegen den das Review urteilt.

## Hinweis zur Entstehung

Diese Datei wurde beim Repo-Bootstrap von alfred angelegt, ausdruecklich
autorisiert durch ingo.fahrentholz@diva-e.com (2026-08-25). Sie beschreibt
Projekt-Konfiguration, keinen Produktcode.
