# ProofPath design direction

## Audit of the previous UI (baseline: `screenshots/01–16`)

| Problem | Effect on a first-time user |
|---|---|
| Cream background, dark green accent, same card everywhere | Reads as an internal ops dashboard; nothing signals "AI product" |
| First screen is a form asking for a resume and 2–6 postings | High effort before any value; no answer to "why do you need this?" |
| Overview is four equal stat tiles and a list | No single next action; hierarchy is flat |
| Ledger is a dense table with raw priority numbers (`0.412`) | The product's core idea is hidden behind numbers |
| Assessment is a question plus a textarea; the plan change is a link | The best moment (evidence changes the plan) happens off-screen |
| Plan is a grid of identical week cards | Current focus and completion criteria are not visible |
| Agent activity shows raw JSON by default | Transparent but intimidating |
| Seven sidebar items | Too many destinations for a new user |

## Direction: "evidence instrument"

Precise, calm, slightly scientific. The ledger is a measuring instrument; colour is reserved for
evidence state, so a glance tells you where you stand. Indigo is the AI and navigation voice.

- **Type:** Bricolage Grotesque for display (confident, a little warm), Instrument Sans for UI,
  IBM Plex Mono for quotes, IDs and numbers.
- **Surfaces:** cool white page, white cards with hairline borders, one raised level for focus
  panels, midnight navy for the sidebar and hero moments.
- **Motion:** short rise-and-fade on view change, staged reveal on results, bar fills on meters.
  All of it is disabled under `prefers-reduced-motion`.

## Tokens

| Role | Light | Use |
|---|---|---|
| `--ink` | `#101828` | Text, sidebar, hero |
| `--ai` | `#645BFF` | AI actions, navigation, focus ring, proposals |
| `--proof` | `#0E9F92` text / `#21C7B7` fill | Demonstrated and artifact-backed evidence, progress |
| `--warn` | `#B45309` text / `#F5A524` fill | Claimed, partial, uncertain |
| `--gap` | `#D9483B` text / `#FF886D` fill | No evidence, contested, failed checks |
| `--bg` / `--surface` | `#F7F8FC` / `#FFFFFF` | Page / cards |

Every evidence state is shown as **icon + text label + colour**, never colour alone.

## Information architecture

Home · My skills · Practice (Assessments, Projects) · Roadmap · Opportunities, with the
AI coach log as a secondary link. During onboarding the sidebar is hidden.

## Honesty rules the UI must keep

- No readiness percentage, no "job ready" language. ProofPath records evidence; it does not certify.
- Sample data is always labelled fictional.
- An artifact review reads only the pasted excerpt, so it is labelled "Excerpt reviewed", never
  "repository inspected".
- Coach insights come only from logged agent runs. Empty state when there are none.
- The approved plan and a pending proposal are always visually distinct; nothing changes without Accept.
