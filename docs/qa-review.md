# Final QA review

Scope: correctness and clarity pass on the redesigned UI. No redesign, no new features. Scoring rules,
the agent, approval gates and the plan algorithm are unchanged. Screenshots are in
[`screenshots/review/`](../screenshots/review/) as `before-*` / `after-*` pairs.

Test environment: live `claude-opus-5-5`, Chromium via Playwright at 1440×900 and 375×812.
Workspaces: `:8002` (a long-lived workspace with a declined proposal, the stale-plan case),
`:8004` (an empty workspace for the fresh-user journey).

## Defects

### D1. Roadmap showed steps the evidence had already covered as "Current focus"
- **Repro:** pass an artifact review for Git → decline the coach's proposal → open Roadmap.
  Week 1 "Current focus" said *Learn Git* and *Prove Machine learning*; both were Artifact-backed.
- **Root cause:** Roadmap rendered the approved plan without comparing it to the ledger. The plan
  correctly stays put until you approve an update, but the UI presented it as current.
- **Fix:** one shared resolver in `static/ui.js` (`isStepCovered`, `nextPlanStep`). Covered steps get a
  "Covered by newer evidence" badge and are dimmed. "Current focus" moves to the week of the first
  step still needed. A note explains why the plan has not changed.
- **Verified:** on `:8002` the 3 covered steps are marked and focus moved to week 2.
  `before-roadmap-stale.png` → `after-roadmap-stale.png`.

### D2. Next action differed between pages
- **Repro:** same workspace. Home skipped covered steps, Practice showed a generic empty state,
  Skills and Projects gave no next step, and Roadmap pointed at Git.
- **Root cause:** each view derived "what next" on its own; only Home checked the ledger.
- **Fix:** `nextStepCard()` is shared by Home, Practice and the reveal. Skills marks the card
  "Your next step", and Projects marks projects that "Cover your next step".
- **Verified:** `:8002` all five views name SQL. `:8004` after a new assessment and approval, all
  five name Git, and the Python drawer advice matches its Partial level. `after-practice-next-step.png`.
  Locked in by `tests/frontend/next_step.test.mjs` (5 tests).

### D3. Phone navigation scrolled sideways and clipped text
- **Repro:** 375 px wide, any page. The top bar was 419 px wide inside a 375 px viewport, nav labels
  were hidden (icons only), and "New profile" and the engine label were cut off.
- **Root cause:** desktop sidebar squeezed into one horizontal strip.
- **Fix:** below 820 px, a fixed bottom tab bar with six items and visible short labels
  (Home, Skills, Practice, Roadmap, Jobs, Coach). The header holds the brand, a short engine label
  ("Claude", "Offline" or "AI off") and New profile.
- **Verified:** on all 7 routes the document and header are both exactly 375 px wide, all six tabs are
  visible, and the engine label is not clipped. `before-mobile-nav-projects.png` →
  `after-mobile-nav-projects.png`, `after-mobile-nav-home.png`.

### D4. Excerpt reviews were worded like verified repositories
- **Repro:** submit a URL plus pasted README and pass review. The UI said "Excerpt reviewed ·
  evidence accepted" and "Reviewed artifacts", and the ledger reason said "A linked artifact passed
  review".
- **Root cause:** labels described the outcome, not what was actually checked. Only the pasted
  text is read; the link is never fetched.
- **Fix:** "Pasted excerpt passed review", "Pasted excerpt needs work", "Submitted, awaiting
  review", "Reviewed excerpts". The ledger reason (display text in `app/ledger.py`) now says the
  repository itself was not inspected.
- **Verified:** Git drawer and project cards show the new wording. `before-drawer-labels.png` →
  `after-drawer-labels.png`, `before-projects-labels.png` → `after-projects-labels.png`.

### D5. Application tiles were ambiguous
- **Repro:** log one rejection. Tiles read *Applied 0 · Rejected 1*, which looks like "zero
  applications", and the trends table's "Applied" column meant something different (total logged).
  The response-rate column was cut off in the half-width card.
- **Root cause:** the status name `applied` (still waiting) was shown as if it were a total.
- **Fix:** a "Logged in total" tile, "Applied" renamed "Awaiting reply", a one-line definition of
  outcome and response, a tooltip per status, the table column renamed "Logged", and the trends card
  made full width.
- **Verified:** `before-opportunities.png` → `after-opportunities.png`; the table fits without
  scrolling at 1440 px. Phone: `after-mobile-opportunities.png`.

### D6. Contrast, type size and focus
- **Measured (WCAG ratio, 4.5:1 required for small text):** turquoise badge 2.97, coral badge
  3.78, white on solid green 3.28, white on the dark-mode primary button 3.10.
- **Fix:** text tokens darkened to 4.53, 5.26 and 5.01; primary buttons use `#645BFF` (4.69) in both
  themes. 11 rules under 12.5 px raised to 12.5 px (phone tab labels stay at 12 px); nested monospace
  text was 11.8 px and is now above 12 px. The hidden file input inside the upload button now shows a
  focus ring.
- **Verified:** a script found no text under 12 px on any phone route. Keyboard focus on nav links,
  buttons and links shows a 3 px indigo ring (≥3:1 against the page and the navy sidebar).

### D7. Coach log was verbose and stated outdated status
- **Repro:** open the AI coach log after declining a proposal. Each run listed every tool call in
  full. The summary still said "It's waiting for you to accept or reject it", and Home repeated it.
- **Root cause:** the agent's summary is written when it proposes; the decision came later and was
  never shown next to it.
- **Fix:** each run shows a one-line outcome, then "Show N steps" (opened automatically in developer
  view). A Decision line comes from persisted plan versions ("You declined update v3", "You accepted
  update v2", or "waiting"). Home's coach card shows the same decision.
- **Verified:** `before-coach-log.png` → `after-coach-log.png`.

### D8. Progress checkmarks were decorative
- **Repro:** submit the intake or an answer. Steps ticked on 6–6.5 s timers, unrelated to the server.
- **Root cause:** the intake and grading endpoints are single requests with no progress events.
- **Fix:** the list is presented as what the server does inside one request, with no per-step ticks,
  plus a real elapsed-time counter. The page updates when the request finishes.
- **Verified:** live intake (3 s in) and grading (3 s in) show zero completed ticks and a running
  clock. `before-intake-progress.png` → `after-intake-progress.png`,
  `before-grading-progress.png` → `after-grading-progress.png`.

### D9. Returning browsers kept the old front end after an update (found during this pass)
- **Repro:** load the app, deploy new JS with a new `?v=` query string, revisit. The browser still
  ran the old scripts.
- **Root cause:** `index.html` was served without cache headers, so the browser reused the cached
  page and never requested the new asset URLs.
- **Fix:** `GET /` sends `Cache-Control: no-cache`, and assets are bumped to `?v=5`. Test:
  `test_index_page_is_revalidated_so_new_assets_load`.
- **Verified:** after a reload the browser loads `?v=5` scripts.

### D10. "6/8 · Partial" with no explanation
- **Repro (live):** an answer scored 6/8 and was graded Partial.
- **Root cause:** a pass also requires correctness to be met; the result page didn't say so.
- **Fix:** a "Why not a pass" line appears when the score is 6 or more but correctness wasn't met.
- **Verified:** rendered from the stored assessment (correctness: partial).
  `after-result-partial-reason.png`.

## Fresh-user journey (`:8004`, live Claude)

| Step | Result |
|---|---|
| Sample onboarding → intake | 18 skills, plan v1, reveal shown, no errors |
| Recommended first move | "Your Python experience is claimed, but not yet demonstrated." (same on Home) |
| Assessment → grading | 6/8 Partial; ledger Claimed 0.25 → Partial 0.45; proposal citing events #4 and #9 |
| Accept → hard reload | v2 active, v1 superseded, no pending proposal, Python still Partial |
| Next step after reload | Git, consistent on Home, Skills, Practice and Roadmap |

## Tests

- `.venv/bin/python -m pytest -q`: **32 passed** (31 existing plus the cache-header test).
- `node --test tests/frontend`: **5 passed** (new; shared next-step logic).
- `node --check` on all 9 front-end scripts: clean.

## Known limits, not fixed

- The coach's own summary text can still say "waiting"; the Decision line next to it is the source
  of truth.
- Dark mode was checked by contrast calculation and a spot check, not a full visual pass.
- Wide tables scroll inside their card on phones (intentional; the page itself does not scroll sideways).
- There is no automated browser end-to-end suite; the journey above was run by hand through Playwright.
