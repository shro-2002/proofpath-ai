/* Projects, opportunities (applications) and the coach activity log. */
"use strict";

/* ---- projects ---- */

function projectStatus(p) {
  const arts = p.artifacts;
  if (!arts.length) return tag("Not submitted", "neutral");
  if (arts.some((a) => a.review_status === "passed")) return tag("Pasted excerpt passed review", "ok");
  const last = arts[arts.length - 1];
  if (last.review_status === "failed") return tag("Pasted excerpt needs work", "gap");
  return tag("Submitted, awaiting review", "warn");
}

function artifactRow(a) {
  const review = a.review
    ? `<p class="small muted">${esc(a.review.summary)} · ${a.review.met} of ${a.review.of} criteria met with verified quotes from the excerpt.</p>`
    : `<button class="btn sm primary" data-action="review-artifact" data-id="${a.id}">${icon("eye")} Review excerpt against criteria</button>`;
  return `<div class="card flat stack-s" style="padding:14px">
    <div class="spread small"><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${icon("link")} ${esc(a.url)}</a>${artifactBadge(a)}</div>
    ${review}<span class="small muted">Only the pasted excerpt is reviewed. The repository itself is not fetched or inspected.</span></div>`;
}

function projectCard(p, nextSkill) {
  const coversNext = nextSkill && p.skill_ids.includes(nextSkill.skill_id);
  return `<article class="card project">
    ${coversNext ? `<span class="badge tone-ai" style="align-self:flex-start">${icon("sparkle")}Covers your next step: ${esc(nextSkill.skill)}</span>` : ""}
    <div class="spread"><span class="eyebrow">${esc(plural(p.skills.length, "skill"))} · ${esc(plural(p.acceptance.length, "acceptance check"))}</span>${projectStatus(p)}</div>
    <h3>${esc(p.title)}</h3>
    <p class="small" style="color:var(--ink-2)">${esc(p.brief)}</p>
    <div class="row">${p.skills.map((s) => `<button class="chip" data-action="open-skill" data-skill="${esc(s.skill_id)}">${esc(s.name)}</button>`).join("")}</div>
    <div class="flag" style="background:var(--proof-soft)">${icon("shield")}<span>Could make ${esc(p.skills.map((s) => s.name).join(", "))} artifact-backed once a pasted README or code excerpt passes review. ProofPath reads the excerpt, not the repository.</span></div>
    <details><summary>Acceptance criteria</summary><ul class="small" style="margin:8px 0 0;padding-left:18px">${p.acceptance.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></details>
    ${p.artifacts.map(artifactRow).join("")}
    <details><summary>${p.artifacts.length ? "Submit another version" : "Submit your work"}</summary>
      <form class="stack-s artifact-form" data-project="${p.id}" style="margin-top:10px">
        <label class="field">Link to your work <input type="url" name="url" required placeholder="https://github.com/you/project"></label>
        <label class="field">README or code excerpt <span class="hint">At least 200 characters. This text is what gets reviewed; links are not opened.</span><textarea name="submitted_text" rows="5" class="mono-input"></textarea></label>
        <button class="btn" type="submit">${icon("upload")} Submit for review</button></form></details>
  </article>`;
}

Views.projects = (projects, state) => {
  const next = nextPlanStep(state).item;
  return `<div class="view-enter">${Views.practiceTabs("projects")}
  <div class="page-head"><div><div class="eyebrow">Practice · portfolio</div><h1>Projects that close real gaps</h1>
    <p>Each suggestion targets your highest-priority gaps. Submitted work only counts once its excerpt passes review against the acceptance criteria, with every quote checked in code.</p></div>
    <button class="btn ${projects.length ? "" : "primary"}" data-action="generate-projects" type="button">${icon("sparkle")} ${projects.length ? "Suggest new projects" : "Suggest projects for my gaps"}</button></div>
  ${projects.length ? `<div class="grid-2">${projects.map((p) => projectCard(p, next)).join("")}</div>`
    : `<div class="empty">${icon("file")}<strong>No project suggestions yet</strong><span>ProofPath designs small portfolio projects around the skills you can't prove yet.</span></div>`}</div>`;
};

/* ---- opportunities ---- */

const APP_STATUSES = [["applied", "Awaiting reply"], ["no_response", "No response"], ["rejected", "Rejected"], ["interview", "Interview"], ["offer", "Offer"]];
const STATUS_MEANING = {
  applied: "Sent, no answer yet. Not counted as an outcome.",
  no_response: "You've given up waiting. Counts as an outcome without a response.",
  rejected: "Turned down. Counts as an outcome without a response.",
  interview: "Got an interview. Counts as a response.",
  offer: "Got an offer. Counts as a response.",
};

function insightCard(ins) {
  const need = ins.thresholds?.min_total || 8;
  const progress = Math.min(1, ins.total_outcomes / need);
  return `<section class="card stack-s ${ins.signal ? "coach" : ""}">
    <div class="spread"><span class="eyebrow ${ins.signal ? "ai" : ""}">Response trends</span><span class="small muted">${ins.total_outcomes} of ${need} outcomes needed</span></div>
    ${meter(progress, ins.signal ? "ai" : "")}
    <p>${esc(ins.message)}</p>
    <p class="small muted">Outcomes are correlations, not causes. ProofPath adjusts priorities only when response rates by role type separate beyond their 95% intervals, and still asks you before changing the roadmap.</p>
    ${ins.families.length ? `<div class="table-wrap"><table><thead><tr><th>Role type</th><th>Logged</th><th>Outcomes</th><th>Responses</th><th>Response rate (95% interval)</th></tr></thead><tbody>
    ${ins.families.map((f) => `<tr><td>${esc(f.role_family)}</td><td>${f.applied}</td><td>${f.outcomes}</td><td>${f.responded}</td><td class="mono small">${f.response_rate === null ? "–" : `${Math.round(f.response_rate * 100)}% (${Math.round(f.ci_low * 100)}–${Math.round(f.ci_high * 100)}%)`}</td></tr>`).join("")}</tbody></table></div>` : ""}</section>`;
}

Views.opportunities = (data, families) => {
  const counts = Object.fromEntries(APP_STATUSES.map(([k]) => [k, data.applications.filter((a) => a.status === k).length]));
  return `<div class="view-enter">
    <div class="page-head"><div><div class="eyebrow">Opportunities</div><h1>Track applications, learn from responses</h1>
      <p>Log where you applied and what happened. With enough outcomes, ProofPath can tell which role types respond, without reading meaning into a handful of rejections.</p></div></div>
    <div class="stack">
      <section aria-labelledby="pipeline-title"><h2 id="pipeline-title" class="sr-only">Applications by status</h2>
        <div class="pipeline"><div class="total"><b>${data.applications.length}</b><span>Logged in total</span></div>${APP_STATUSES.map(([k, l]) => `<div title="${esc(STATUS_MEANING[k])}"><b>${counts[k]}</b><span>${l}</span></div>`).join("")}</div>
        <p class="small muted" style="margin-top:10px"><b>Outcome</b> = no response, rejected, interview or offer. <b>Response</b> = interview or offer. "Awaiting reply" is not an outcome yet, so it doesn't affect trends.</p></section>
      <div class="stack">
        ${insightCard(data.insights)}
        <form id="app-form" class="card stack-s"><h3>Log an application</h3>
          <div class="grid-2"><label class="field">Company <input type="text" name="company" required maxlength="120"></label>
          <label class="field">Role title <input type="text" name="role_title" required maxlength="120"></label></div>
          <div class="grid-2"><label class="field">Role type <input type="text" name="role_family" list="families" required maxlength="80"><datalist id="families">${families.map((f) => `<option value="${esc(f)}">`).join("")}</datalist></label>
          <label class="field">Status <select name="status">${APP_STATUSES.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label></div>
          <button class="btn primary" type="submit">Log application</button></form>
      </div>
      ${data.applications.length ? `<div class="table-wrap"><table><thead><tr><th>Company</th><th>Role</th><th>Type</th><th>Status</th></tr></thead><tbody>
        ${data.applications.map((a) => `<tr><td><strong>${esc(a.company)}</strong></td><td>${esc(a.role_title)}</td><td>${esc(a.role_family)}</td><td><select data-action="app-status" data-id="${a.id}" aria-label="Status for ${esc(a.company)}">${APP_STATUSES.map(([k, l]) => `<option value="${k}" ${k === a.status ? "selected" : ""}>${l}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div>`
    : `<div class="empty">${icon("briefcase")}<strong>No applications yet</strong><span>Log your first one above. Trends appear after ${data.insights.thresholds?.min_total || 8} outcomes.</span></div>`}
    </div></div>`;
};

/* ---- coach activity ---- */

const TOOL_TEXT = {
  get_ledger_summary: () => "Reviewed your evidence ledger",
  get_skill_evidence: (i) => `Reviewed evidence for ${i.skill_id || "a skill"}`,
  preview_plan_change: () => "Previewed how your roadmap would change",
  propose_plan_change: () => "Proposed a roadmap update",
  get_application_insights: () => "Checked application response patterns",
  select_assessment_target: (i) => `Chose ${i.skill_id || "a skill"} for your next check`,
};

function describe(e) {
  const d = e.detail || {};
  const failed = d.result && typeof d.result === "object" && d.result.error;
  if (TOOL_TEXT[e.action]) return { text: failed ? `${TOOL_TEXT[e.action](d.input || {})}: refused by validation (${d.result.error})` : TOOL_TEXT[e.action](d.input || {}), kind: failed ? "wait" : "agent", ic: failed ? "alert" : "sparkle" };
  const map = {
    agent_started: { text: `Started: ${TRIGGER_LABEL[e.trigger] || humanize(e.trigger)}`, kind: "", ic: "pulse" },
    summary: { text: plainText(d.text), kind: "agent", ic: "sparkle" },
    agent_failed: { text: `Coach step failed: ${d.error}`, kind: "wait", ic: "alert" },
    intake_completed: { text: "Built your evidence ledger from the resume and postings", kind: "", ic: "layers" },
    accepted_plan: { text: `You accepted roadmap v${d.version ?? ""}`, kind: "", ic: "check" },
    rejected_plan: { text: "You kept the current roadmap", kind: "", ic: "x" },
    no_change: { text: `No change: ${d.reason || ""}`, kind: "", ic: "clock" },
  };
  return map[e.action] || { text: humanize(e.action), kind: "", ic: "pulse" };
}

function groupRuns(entries) {
  const runs = [];
  for (const e of entries.slice().reverse()) {
    const last = runs[runs.length - 1];
    if (last && last.run_id === e.run_id) last.items.push(e);
    else runs.push({ run_id: e.run_id, trigger: e.trigger, items: [e] });
  }
  return runs.reverse();
}

/* One readable line per run: the coach's own summary (clipped), else the system's reason, else the last step. */
function runOutcome(r) {
  const summary = r.items.find((e) => e.action === "summary");
  if (summary) return { text: plainText(summary.detail.text, 200), ic: "sparkle", kind: "agent" };
  const last = describe(r.items[r.items.length - 1]);
  return { text: plainText(last.text, 200), ic: last.ic, kind: last.kind };
}

/* The coach's summary is written at proposal time; the decision comes from persisted plan versions. */
function proposalDecision(r, versionStatus) {
  const made = r.items.find((e) => e.action === "propose_plan_change" && e.detail.result && e.detail.result.proposal_version);
  if (!made) return "";
  const v = made.detail.result.proposal_version;
  const status = versionStatus[v];
  if (status === "proposed") return `<div class="run-step wait"><span class="icon-wrap">${icon("clock")}</span><div class="small"><strong>Update v${v} is waiting for your approval.</strong> <a href="#/roadmap">Review it</a></div></div>`;
  const text = { rejected: `You declined update v${v}. The roadmap stayed as it was.`, active: `You accepted update v${v}.`, superseded: `You accepted update v${v}; a later version has since replaced it.` }[status];
  return text ? `<div class="run-step"><span class="icon-wrap">${icon(status === "rejected" ? "x" : "check")}</span><div class="small"><strong>Decision:</strong> ${esc(text)}</div></div>` : "";
}

function runCard(r, dev, versionStatus) {
  const outcome = runOutcome(r);
  const steps = r.items.map((e) => {
    const info = describe(e);
    return `<div class="run-step ${info.kind}"><span class="icon-wrap">${icon(info.ic)}</span><div><div class="small">${esc(info.text)}</div>
      ${dev ? `<div class="dev">${esc(`${e.ts} · ${e.actor} · ${e.action}\n${JSON.stringify(e.detail, null, 2)}`)}</div>` : ""}</div></div>`;
  }).join("");
  return `<section class="card run">
    <div class="spread"><h3>${esc(TRIGGER_LABEL[r.trigger] || humanize(r.trigger))}</h3><span class="small muted">${esc(fmtTime(r.items[0].ts))}${dev ? ` · <span class="mono">run ${esc(r.run_id)}</span>` : ""}</span></div>
    <div class="run-step ${outcome.kind}"><span class="icon-wrap">${icon(outcome.ic)}</span><p class="small">${esc(outcome.text)}</p></div>
    ${proposalDecision(r, versionStatus)}
    <details ${dev ? "open" : ""}><summary>${dev ? "Raw steps" : `Show ${plural(r.items.length, "step")}`}</summary><div style="margin-top:6px">${steps}</div></details>
  </section>`;
}

Views.activity = (entries, dev, versions) => {
  const runs = groupRuns(entries);
  const versionStatus = Object.fromEntries(versions.map((v) => [v.version, v.status]));
  return `<div class="view-enter">
    <div class="page-head"><div><div class="eyebrow">AI coach log</div><h1>What your coach did, and why</h1>
      <p>The coach acts only through tools that code validates. Refused calls are shown with their reason. Switch to the developer view for raw inputs, outputs and IDs.</p></div>
      <div class="seg-toggle" role="group" aria-label="Log detail">
        <button type="button" data-action="activity-mode" data-dev="0" aria-pressed="${!dev}">${icon("user")}Readable</button>
        <button type="button" data-action="activity-mode" data-dev="1" aria-pressed="${dev}">${icon("code")}Developer</button></div></div>
    ${runs.length ? `<div class="stack">${runs.map((r) => runCard(r, dev, versionStatus)).join("")}</div>` : `<div class="empty">${icon("pulse")}No coach activity yet.</div>`}</div>`;
};
