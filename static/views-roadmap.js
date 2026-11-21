/* Roadmap: proposal comparison (human approval), then a milestone timeline of the approved plan. */
"use strict";

function diffValue(field, value) {
  if (field === "first_week") return value ? `week ${value}` : "backlog";
  if (field === "hours") return `${value} h`;
  if (field === "action") return (ACTION_META[value] || {}).label || value;
  return value;
}

function changedEntry(c) {
  const fields = Object.entries(c.fields).filter(([f]) => !(f === "detail" && c.fields.action));
  return `<div class="diff-entry"><strong>${esc(c.skill)}</strong>
    ${fields.map(([f, v]) => `<div class="small"><span class="muted">${esc(humanize(f))}:</span> <span class="before">${esc(diffValue(f, v.before))}</span> → <span class="after">${esc(diffValue(f, v.after))}</span></div>`).join("")}
    ${c.fields.action && c.fields.detail ? `<div class="small muted" style="margin-top:4px">${esc(c.fields.detail.after)}</div>` : ""}</div>`;
}

Views.diff = (d) => `
  <div class="compare">
    <div class="compare-col removed"><h4>${icon("x")} Removed · ${d.removed.length}</h4>${d.removed.map((r) => `<div class="diff-entry"><strong>${esc(r.skill)}</strong><div class="small before">${esc(diffValue("action", r.action))} · ${r.hours} h</div></div>`).join("") || '<span class="small muted">Nothing removed</span>'}</div>
    <div class="compare-col changed"><h4>${icon("refresh")} Changed · ${d.changed.length}</h4>${d.changed.map(changedEntry).join("") || '<span class="small muted">Nothing changed</span>'}</div>
    <div class="compare-col added"><h4>${icon("check")} Added · ${d.added.length}</h4>${d.added.map((a) => `<div class="diff-entry"><strong>${esc(a.skill)}</strong><div class="small after">${esc(diffValue("action", a.action))} · ${a.hours} h</div></div>`).join("") || '<span class="small muted">Nothing added</span>'}</div>
  </div>
  ${(d.rescheduled || []).length ? `<p class="small muted">Knock-on schedule shifts: ${d.rescheduled.map((r) => `${esc(r.skill)} (${esc(diffValue("first_week", r.before))} → ${esc(diffValue("first_week", r.after))})`).join(", ")}</p>` : ""}`;

function proposalPanel(p) {
  return `<section class="card wow stack" style="margin-bottom:26px">
    <div class="wow-head"><span class="icon-wrap">${icon("sparkle")}</span><div style="flex:1">
      <div class="eyebrow ai">Recommended by your AI coach · v${p.base_version} → v${p.version}</div><h2>${esc(p.reason)}</h2></div></div>
    <div class="row small"><span class="muted">Triggered by ${esc(TRIGGER_LABEL[p.trigger] || humanize(p.trigger))}.</span>
      <span class="muted">Evidence cited:</span>${p.cited_events.map((id) => `<span class="cite">#${id}</span>`).join("") || '<span class="muted">application statistics</span>'}</div>
    ${Views.diff(p.diff)}
    <div class="spread"><span class="small muted">Nothing changes until you decide. Rejecting keeps plan v${p.base_version} exactly as it is.</span>
      <div class="row"><button class="btn" data-action="reject-proposal" data-id="${p.id}">Keep current plan</button>
      <button class="btn primary" data-action="accept-proposal" data-id="${p.id}">${icon("check")} Accept update</button></div></div>
  </section>`;
}

function taskCard(i, row) {
  const meta = ACTION_META[i.action] || ACTION_META.prove;
  const covered = isStepCovered(i, row);
  return `<div class="task ${covered ? "covered" : ""}">
    ${covered ? `<span class="badge tone-ok">${icon("checkCircle")}Covered by newer evidence: ${esc(LEVEL_LABEL[row.level])}</span>` : ""}
    <div class="spread"><span class="badge tone-ai">${icon(meta.icon)}${esc(meta.label)}${i.part > 1 ? " (cont.)" : ""}</span><span class="mono small muted">${i.hours} h</span></div>
    <button class="skill-btn" type="button" data-action="open-skill" data-skill="${esc(i.skill_id)}"><h3>${esc(i.skill)}</h3></button>
    <span class="small muted">${esc(i.detail)}</span>
    ${i.why ? `<span class="small">${icon("briefcase")} Asked in ${esc(i.why.demand)}</span>` : ""}
    <span class="done-when">${icon("checkCircle")}<span><b>Done when:</b> ${esc(meta.done)}</span></span></div>`;
}

function roadmapTimeline(active, state) {
  const plan = active.plan;
  const rowOf = (i) => state.ledger.find((r) => r.skill_id === i.skill_id);
  const focusWeek = nextPlanStep(state).item?.week;
  return `<div class="road">${plan.weeks.map((w) => `<section class="milestone ${w.week === focusWeek ? "current" : ""}">
      <div class="milestone-head"><h2>Week ${w.week}${w.week === focusWeek ? ' <span class="badge tone-ai" style="vertical-align:middle">Current focus</span>' : ""}</h2>
        <span class="small muted">${w.items.reduce((n, i) => n + i.hours, 0)} of ${plan.hours_per_week} h · ${esc(w.items.map((i) => i.skill).filter((v, j, arr) => arr.indexOf(v) === j).join(", "))}</span></div>
      <div class="tasks">${w.items.map((i) => taskCard(i, rowOf(i))).join("")}</div></section>`).join("")}
    ${plan.backlog.length ? `<section class="milestone"><div class="milestone-head"><h2>Later</h2><span class="small muted">Beyond week ${plan.weeks.length}</span></div>
      <div class="row">${plan.backlog.map((b) => `<button class="chip" data-action="open-skill" data-skill="${esc(b.skill_id)}">${esc(b.skill)} · ${b.hours} h</button>`).join("")}</div></section>` : ""}
  </div>`;
}

const VERSION_TONE = { active: "ok", proposed: "ai", rejected: "gap", superseded: "neutral" };

Views.roadmap = (p, state) => {
  const active = p.active;
  const covered = active ? nextPlanStep(state).covered : 0;
  const status = active ? `<div class="plan-status">${icon("route")}<strong>Approved plan v${active.version}</strong>
      <span class="muted">· ${active.plan.hours_per_week} h/week · ${esc(active.reason)}</span>
      ${p.proposal ? `<span class="badge tone-ai" style="margin-left:auto">${icon("sparkle")}Update v${p.proposal.version} waiting for you</span>` : ""}</div>
    ${covered && !p.proposal ? `<div class="flag" style="margin:-6px 0 18px">${icon("alert")}<span>${esc(plural(covered, "step"))} below ${covered === 1 ? "is" : "are"} already covered by newer evidence. The approved plan only changes when you accept an update; your coach proposes one after your next assessment or project review.</span></div>` : ""}` : "";
  return `<div class="view-enter">
    <div class="page-head"><div><div class="eyebrow">My roadmap</div><h1>Your path, week by week</h1>
      <p>Computed by code from your evidence ledger. When new evidence changes it, your coach proposes an update, and the approved plan stays as it is until you accept.</p></div></div>
    ${p.proposal ? proposalPanel(p.proposal) : ""}
    ${status}
    ${active ? roadmapTimeline(active, state) : `<div class="empty">${icon("route")}No plan yet.</div>`}
    <details class="card" style="margin-top:10px"><summary>Version history · ${p.versions.length}</summary>
      <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>Version</th><th>Status</th><th>Trigger</th><th>Reason</th><th>When</th></tr></thead><tbody>
      ${p.versions.map((v) => `<tr><td class="mono">v${v.version}</td><td>${tag(v.status, VERSION_TONE[v.status] || "neutral")}</td><td class="small">${esc(TRIGGER_LABEL[v.trigger] || humanize(v.trigger))}</td><td class="small">${esc(v.reason)}</td><td class="small muted">${esc(fmtTime(v.created_at))}</td></tr>`).join("")}
      </tbody></table></div></details>
  </div>`;
};
