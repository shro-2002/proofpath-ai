/* Home: one hero, one next action, then evidence, gaps, coach insights and recent checks. */
"use strict";

function proposalCallout(proposal) {
  if (!proposal) return "";
  const d = proposal.diff;
  const n = d.changed.length + d.added.length + d.removed.length;
  return `<div class="proposal-callout" role="status">
    <div class="row" style="flex:1;min-width:240px"><span class="icon-wrap">${icon("sparkle")}</span>
      <div><strong>Your coach recommends a roadmap update</strong><div class="small muted">${esc(plainText(proposal.reason, 170))} · ${esc(plural(n, "change"))} · waiting for your approval</div></div></div>
    <a class="btn primary" href="#/roadmap">Review before / after ${icon("arrow")}</a></div>`;
}

function heroSummary(s) {
  const L = s.ledger;
  const proven = L.filter((r) => ["demonstrated", "artifact_backed"].includes(r.level)).length;
  const claimed = L.filter((r) => ["claimed", "partial"].includes(r.level) && !r.contested).length;
  const gaps = L.filter((r) => r.level === "none" || r.contested).length;
  return `${plural(L.length, "skill")} across ${plural(s.jds.length, "posting")}: ${proven} proven, ${claimed} claimed but not yet tested, ${gaps} with no evidence or conflicting results.`;
}

function staleNote(covered) {
  if (!covered) return "";
  return `<p class="small muted" style="margin-top:12px">${icon("alert")} ${esc(plural(covered, "step"))} in your approved roadmap ${covered === 1 ? "is" : "are"} already covered by newer evidence. <a href="#/roadmap">See roadmap</a>.</p>`;
}

/* Shared by Home, Practice and Projects so every view names the same next step. */
function nextStepCard(s, { heading = "Your next best step" } = {}) {
  const { item, row, covered } = nextPlanStep(s);
  if (!item) {
    return `<section class="card next-action raised"><div class="eyebrow ai">${esc(heading)}</div><h2>Every step in your roadmap is covered by your evidence.</h2>
      <p class="why">Keep logging applications so ProofPath can learn which role types respond.</p>${staleNote(covered)}</section>`;
  }
  const shown = row || { name: item.skill, level: item.why.level };
  const meta = ACTION_META[item.action] || ACTION_META.prove;
  return `<section class="card next-action raised">
    <div class="eyebrow ai">${esc(heading)}</div>
    <h2>${esc(firstLine(shown))}</h2>
    <p class="why">${esc(item.detail)}</p>
    <div class="meta-row"><span>${icon(meta.icon)}${esc(meta.label)}</span><span>${icon("clock")}${item.hours} h in week ${item.week}</span><span>${icon("briefcase")}${esc(shown.demand ? demandText(shown.demand) : item.why.demand)}</span></div>
    <div class="row" style="margin-top:18px">
      ${canAssessRow(shown)
    ? `<button class="btn primary lg" type="button" data-action="assess-skill" data-skill="${esc(item.skill_id)}">Take a 10-minute assessment ${icon("arrow")}</button>`
    : `<a class="btn primary lg" href="#/projects">Find a project for ${esc(item.skill)} ${icon("arrow")}</a>`}
      <button class="btn lg" type="button" data-action="agent-next">${icon("sparkle")} Let my coach choose</button>
    </div>${staleNote(covered)}</section>`;
}

function gapsCard(ledger) {
  const open = ledger.filter((r) => r.level !== "artifact_backed").slice(0, 6);
  const top = open[0]?.priority || 1;
  return `<section class="card"><div class="spread" style="margin-bottom:6px"><h3>Gaps by priority</h3><a class="small" href="#/skills">All skills</a></div>
    <p class="small muted" style="margin-bottom:8px">Ranked by how often postings ask × how little evidence you have.</p>
    <div class="gap-list">${open.map((r) => `<button class="gap-row" type="button" data-action="open-skill" data-skill="${esc(r.skill_id)}">
      <strong>${esc(r.name)}</strong>${levelBadge(r)}${meter(r.priority / top, "ai")}</button>`).join("") || '<p class="muted small">No open gaps.</p>'}</div></section>`;
}

/* Only logged agent runs appear here. No run, no insight. */
const DECISION_TEXT = {
  proposed: "waiting for your approval",
  rejected: "you declined it",
  active: "you accepted it",
  superseded: "you accepted it",
  replaced: "replaced by a newer update before you decided",
};

function coachCard(activity, proposal, versionStatus) {
  const summaries = activity.filter((e) => e.action === "summary").slice(0, 3);
  const decisionFor = (runId) => {
    const made = activity.find((e) => e.run_id === runId && e.action === "propose_plan_change" && e.detail.result && e.detail.result.proposal_version);
    if (!made) return "";
    const v = made.detail.result.proposal_version;
    return DECISION_TEXT[versionStatus[v]] ? ` · Update v${v}: ${DECISION_TEXT[versionStatus[v]]}` : "";
  };
  const items = summaries.map((e) => `<div class="coach-item">${icon("sparkle")}<div><div>${esc(plainText(e.detail.text, 220))}</div>
    <div class="small muted">${esc(TRIGGER_LABEL[e.trigger] || humanize(e.trigger))} · ${esc(fmtTime(e.ts))}<strong>${esc(decisionFor(e.run_id))}</strong></div></div></div>`).join("");
  return `<section class="card coach"><div class="spread" style="margin-bottom:6px"><h3>Your AI coach noticed</h3><a class="small" href="#/activity">Full log</a></div>
    ${items || `<p class="small muted">Nothing yet. Your coach reviews the ledger after every assessment, artifact review or meaningful application pattern, and explains what it decided here.</p>`}
    ${proposal ? `<a class="btn sm primary" style="margin-top:10px" href="#/roadmap">Review the recommended update</a>` : ""}</section>`;
}

function recentChecks(assessments) {
  const graded = assessments.filter((a) => a.status === "graded").slice(-5).reverse();
  if (!graded.length) return "";
  return `<section class="card"><h3 style="margin-bottom:8px">Recent checks</h3><div class="mini-timeline">
    ${graded.map((a) => `<div><i class="${esc(a.outcome)}"></i><button class="skill-btn" type="button" data-action="open-skill" data-skill="${esc(a.skill_id)}">${esc(a.skill_name)}</button><span class="row">${outcomeTag(a.outcome)}<span class="mono small muted">${a.total}/${a.max_total}</span></span></div>`).join("")}</div></section>`;
}

function milestoneCard(plan) {
  const week = plan?.plan?.weeks?.[0];
  if (!week) return "";
  return `<section class="card"><div class="spread" style="margin-bottom:8px"><h3>This week's milestone</h3><span class="small muted">Plan v${plan.version}</span></div>
    <div class="stack-s">${week.items.map((i) => `<div class="spread small"><span class="row">${icon((ACTION_META[i.action] || {}).icon || "target")}<strong>${esc(i.skill)}</strong><span class="muted">${esc((ACTION_META[i.action] || {}).label || i.action)}</span></span><span class="mono muted">${i.hours} h</span></div>`).join("")}</div>
    <a class="small" style="display:inline-block;margin-top:10px" href="#/roadmap">Open roadmap</a></section>`;
}

Views.home = (s, activity, assessments, versions) => {
  const versionStatus = Object.fromEntries(versions.map((v) => [v.version, decisionState(v)]));
  const from = s.profile.current_role ? `From ${esc(s.profile.current_role)} · ` : "";
  return `<div class="view-enter">
    ${proposalCallout(s.proposal)}
    <section class="hero">
      <div class="eyebrow">${from}${s.profile.hours_per_week} h a week</div>
      <h1>Your path to becoming a <em>${esc(s.profile.target_role)}</em></h1>
      <p class="summary">${esc(heroSummary(s))}</p>
      ${segBar(s.ledger)}
      <p class="disclaimer">ProofPath records evidence. It does not certify that anyone is ready for a job.</p>
    </section>
    <div class="home-grid">
      <div class="stack">${nextStepCard(s)}${coachCard(activity, s.proposal, versionStatus)}${recentChecks(assessments)}</div>
      <div class="stack">${gapsCard(s.ledger)}${milestoneCard(s.plan)}</div>
    </div>
  </div>`;
};

const TRIGGER_LABEL = {
  after_assessment: "After an assessment",
  after_artifact: "After an artifact review",
  after_application: "After an application update",
  select_probe: "Choosing your next check",
  intake: "Profile created",
  user: "Your decision",
};
