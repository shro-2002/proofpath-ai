/* My skills: grouped cards for everyone, a dense table for power users, and the evidence drawer. */
"use strict";

const SKILL_GROUPS = [
  { key: "gap", title: "Gaps to close", blurb: "Employers ask for these and you have no evidence yet, or a check contradicted your resume.", test: (r) => r.level === "none" || r.contested },
  { key: "claim", title: "Claimed, needs proof", blurb: "Your resume backs these with a verified sentence. A check turns a claim into proof.", test: (r) => ["claimed", "partial"].includes(r.level) && !r.contested },
  { key: "proof", title: "Proven", blurb: "Demonstrated in a passed assessment, or backed by a project excerpt that passed review.", test: (r) => ["demonstrated", "artifact_backed"].includes(r.level) && !r.contested },
];

const FILTERS = [
  ["all", "All"], ["none", "No evidence"], ["claimed", "Claimed"], ["contested", "Contested"],
  ["partial", "Partial"], ["demonstrated", "Demonstrated"], ["artifact_backed", "Artifact-backed"],
];

function matchesFilter(r, filter) {
  if (filter === "all") return true;
  if (filter === "contested") return r.contested;
  return r.level === filter;
}

function skillCard(r, nextId) {
  return `<button class="skill-card" type="button" data-action="open-skill" data-skill="${esc(r.skill_id)}">
    ${r.skill_id === nextId ? `<span class="badge tone-ai" style="align-self:flex-start">${icon("sparkle")}Your next step</span>` : ""}
    <div class="spread"><h3>${esc(r.name)}</h3>${levelBadge(r)}</div>
    ${strengthMeter(r)}
    <span class="demand">${esc(demandText(r.demand))}</span>
    <span class="next">${icon("arrow")}${esc(nextStepFor(r))}</span></button>`;
}

function skillTable(rows) {
  return `<div class="table-wrap"><table>
    <thead><tr><th scope="col">Skill</th><th scope="col">Evidence</th><th scope="col">Strength</th><th scope="col">Certainty</th><th scope="col">Demand</th><th scope="col">Priority</th><th scope="col">Last check</th></tr></thead>
    <tbody>${rows.map((r) => `<tr class="clickable" data-action="open-skill" data-skill="${esc(r.skill_id)}">
      <td><button class="skill-btn" data-action="open-skill" data-skill="${esc(r.skill_id)}">${esc(r.name)}</button></td>
      <td>${levelBadge(r)}</td>
      <td class="mono small">${strength(r.strength)}</td>
      <td class="small">${esc(UNCERTAINTY_LABEL[r.uncertainty] || r.uncertainty)}</td>
      <td class="small">${r.demand.jd_count}/${r.demand.jd_total}${r.demand.must_count ? ` · ${r.demand.must_count} must` : ""}</td>
      <td class="mono small">${r.priority.toFixed(3)}${r.response_weight !== 1 ? ` <span class="muted">×${r.response_weight}</span>` : ""}</td>
      <td>${r.last_outcome ? outcomeTag(r.last_outcome) : '<span class="muted small">–</span>'}</td></tr>`).join("")}</tbody></table></div>`;
}

Views.skills = (s, filter, mode) => {
  const rows = s.ledger.filter((r) => matchesFilter(r, filter));
  const nextId = nextPlanStep(s).item?.skill_id;
  const body = !rows.length
    ? `<div class="empty">${icon("layers")}No skills match this filter.</div>`
    : mode === "table"
      ? skillTable(rows)
      : SKILL_GROUPS.map((g) => {
        const inGroup = rows.filter(g.test);
        if (!inGroup.length) return "";
        return `<section class="group"><div class="group-head"><h2>${esc(g.title)}</h2><span class="muted">${inGroup.length}</span></div>
          <p class="small muted" style="margin:-6px 0 12px">${esc(g.blurb)}</p>
          <div class="skill-grid">${inGroup.map((r) => skillCard(r, nextId)).join("")}</div></section>`;
      }).join("");
  return `<div class="view-enter">
    <div class="page-head"><div><div class="eyebrow">My skills · evidence ledger</div><h1>What you can prove, skill by skill</h1>
      <p>Every skill here is asked for in your postings. Strength rises only with checked evidence: a resume line is a claim, a passed assessment is a demonstration, a project excerpt that passes review is the strongest proof ProofPath can check.</p></div></div>
    <div class="toolbar">
      <div class="filters" role="group" aria-label="Filter by evidence">${FILTERS.map(([v, l]) => `<button class="filter" type="button" data-action="filter" data-filter="${v}" aria-pressed="${filter === v}">${l}</button>`).join("")}</div>
      <div class="seg-toggle" role="group" aria-label="View mode">
        <button type="button" data-action="skills-mode" data-mode="cards" aria-pressed="${mode !== "table"}">${icon("grid")}Cards</button>
        <button type="button" data-action="skills-mode" data-mode="table" aria-pressed="${mode === "table"}">${icon("list")}Table</button></div>
    </div>
    ${body}</div>`;
};

/* ---- drawer ---- */

const ARTIFACT_STATUS = {
  unreviewed: { label: "Submitted, awaiting review", tone: "neutral" },
  passed: { label: "Pasted excerpt passed review", tone: "ok" },
  failed: { label: "Pasted excerpt needs work", tone: "gap" },
};

function artifactBadge(a) {
  const st = ARTIFACT_STATUS[a.review_status] || ARTIFACT_STATUS.unreviewed;
  return tag(st.label, st.tone);
}

function drawerSection(title, count, body) {
  return `<section><div class="section-title">${esc(title)}${count === null ? "" : ` <span class="badge tone-neutral">${count}</span>`}</div>${body}</section>`;
}

function eventLine(e) {
  const dir = e.after_strength > e.before_strength ? "up" : e.after_strength < e.before_strength ? "down" : "";
  return `<div class="event ${dir}"><div><strong>${esc(humanize(e.kind))}</strong> · ${esc(LEVEL_LABEL[e.before_level])} → ${esc(LEVEL_LABEL[e.after_level])}
    <span class="mono muted">(${strength(e.before_strength)} → ${strength(e.after_strength)})</span></div>
    <div class="muted small">${esc(e.note)} · ${esc(fmtTime(e.created_at))} <span class="event-id">#${e.id}</span></div></div>`;
}

Views.skillDrawer = (k) => {
  const canAssess = k.level !== "artifact_backed";
  return `
  <div class="drawer-head"><div><div class="eyebrow">Skill evidence</div><h2 id="drawer-title">${esc(k.name)}</h2>
    <div class="row" style="margin-top:10px">${levelBadge(k)}${tag(UNCERTAINTY_LABEL[k.uncertainty] || k.uncertainty, "neutral")}</div></div>
    <button class="btn ghost icon-only" data-action="close-drawer" aria-label="Close">${icon("x")}</button></div>
  <div class="evidence-strip">
    <div><b>${k.requirements.length}</b><span>Posting quotes</span></div>
    <div><b>${k.claims.length}</b><span>Resume claims</span></div>
    <div><b>${k.assessments.filter((a) => a.status === "graded").length}</b><span>Assessments</span></div>
    <div><b>${k.artifacts.filter((a) => a.review_status !== "unreviewed").length}</b><span>Reviewed excerpts</span></div>
  </div>
  <div class="card flat stack-s">
    <div class="spread"><span class="eyebrow ai">Next recommended action</span><span class="mono small muted">strength ${strength(k.strength)}</span></div>
    ${strengthMeter(k)}
    <strong>${esc(nextStepFor(k))}</strong>
    <ul class="small muted" style="margin:0;padding-left:18px">${k.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
    ${canAssess ? `<div class="row"><button class="btn primary" data-action="assess-skill" data-skill="${esc(k.skill_id)}" type="button">${icon("target")} Assess ${esc(k.name)}</button><a class="btn" href="#/projects">Find a project</a></div>` : ""}
  </div>
  ${drawerSection("Why employers need it", k.requirements.length, `<div class="stack-s">${k.requirements.map((q) => `<div><div class="quote verified">${esc(q.quote)}</div>
    <div class="source">${icon("check")}${esc(q.title)} · ${esc(q.company)} · ${q.importance === "must" ? "must-have" : "nice-to-have"} · quote found in posting</div></div>`).join("") || '<p class="muted small">No posting asks for this skill.</p>'}</div>`)}
  ${drawerSection("Claimed on your resume", k.claims.length, `<div class="stack-s">${k.claims.map((c) => `<div><div class="quote claim">${esc(c.quote)}</div>
    <div class="source">${icon("dashed")}Found in resume · ${c.match === "explicit" ? "names the skill" : "inferred link, skill not named"} · a claim, not proof</div></div>`).join("") || '<p class="muted small">No resume passage supports this skill. Nothing was invented to fill the gap.</p>'}</div>`)}
  ${drawerSection("Demonstrated in assessments", k.assessments.length, `<div class="stack-s">${k.assessments.map((a) => `<div class="card" style="padding:14px">
    <div class="spread"><span class="small">${esc(a.question.length > 150 ? a.question.slice(0, 150) + "…" : a.question)}</span>${a.status === "graded" ? `<span class="row">${outcomeTag(a.outcome)}<span class="mono small">${a.total}/${a.max_total}</span></span>` : tag("Open", "ai")}</div>
    ${a.status === "graded" ? `<div class="row small" style="margin-top:8px">${a.criteria.map((c) => tag(`${c.criterion}: ${humanize(c.rating)}`, c.rating === "met" ? "ok" : c.rating === "partial" ? "warn" : "gap")).join("")}</div>` : ""}</div>`).join("") || '<p class="muted small">Not assessed yet.</p>'}</div>`)}
  ${drawerSection("Project excerpts", k.artifacts.length, `<div class="stack-s">${k.artifacts.map((a) => `<div class="stack-s"><div class="spread small"><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${icon("link")} ${esc(a.url)}</a>${artifactBadge(a)}</div>
    <span class="small muted">Only the pasted excerpt was reviewed. The linked repository was not fetched or inspected.</span></div>`).join("") || '<p class="muted small">No artifacts linked.</p>'}</div>`)}
  ${drawerSection("Evidence timeline", null, `<div class="timeline">${k.events.map(eventLine).join("") || '<p class="muted small" style="padding-left:16px">No events yet.</p>'}</div>`)}`;
};

Views.rejected = (items) => `
  <div class="drawer-head"><div><div class="eyebrow">Failed verification</div><h2 id="drawer-title">Quotes we could not find</h2></div>
    <button class="btn ghost icon-only" data-action="close-drawer" aria-label="Close">${icon("x")}</button></div>
  <p class="small muted">The model proposed these, but code could not find the quoted text in your documents, so they were discarded rather than trusted.</p>
  <div class="stack-s">${items.map((r) => `<div><div class="quote bad">${esc(r.quote)}</div><div class="source">${esc(r.skill_name)} · ${esc(r.source)} · ${esc(r.reason)}</div></div>`).join("")}</div>`;
