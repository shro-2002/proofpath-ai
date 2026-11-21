/* View templates. Pure functions: data in, escaped HTML out. Interactions use data-action attributes. */
"use strict";

const Views = {};

Views.intake = (sampleLabel) => `
  <div class="page-head">
    <div>
      <div class="eyebrow">New workspace</div>
      <h1>Stop collecting courses. Start proving you're ready.</h1>
      <p>Paste your resume and 2–6 real job descriptions. ProofPath extracts requirements and resume claims, keeps only the ones whose quotes appear word-for-word in your text, and builds a plan from that evidence.</p>
    </div>
    <button class="btn" data-action="load-sample" type="button">Load sample data</button>
  </div>
  <form id="intake-form" class="stack" novalidate>
    <div class="grid-2">
      <div class="card stack">
        <h2>You</h2>
        <label class="field">Resume (plain text)
          <textarea name="resume_text" rows="16" class="mono-input" required minlength="200" placeholder="Paste your resume text"></textarea>
        </label>
        <div class="grid-2">
          <label class="field">Target role <input type="text" name="target_role" required placeholder="e.g. Data Scientist"></label>
          <label class="field">Hours per week <input type="number" name="hours_per_week" min="2" max="40" value="8" required></label>
        </div>
      </div>
      <div class="card stack">
        <div class="spread"><h2>Target job descriptions</h2><button class="btn ghost" data-action="add-jd" type="button">+ Add posting</button></div>
        <div id="jd-list" class="stack"></div>
      </div>
    </div>
    <p id="sample-note" class="small muted" ${sampleLabel ? "" : "hidden"}>${esc(sampleLabel || "")}</p>
    <div class="row"><button class="btn primary" type="submit" id="intake-submit">Build my evidence ledger</button>
    <span class="small muted">Replaces any existing workspace.</span></div>
  </form>
  <div id="intake-progress" hidden></div>`;

Views.jdCard = (index, jd = {}) => `
  <div class="jd-card" data-jd="${index}">
    <div class="spread"><span class="eyebrow">Posting ${index + 1}</span><button class="link-btn" type="button" data-action="remove-jd" data-index="${index}">Remove</button></div>
    <div class="grid-3">
      <label class="field">Title <input type="text" name="title" value="${esc(jd.title)}" required></label>
      <label class="field">Company <input type="text" name="company" value="${esc(jd.company)}" required></label>
      <label class="field">Role type <input type="text" name="role_family" value="${esc(jd.role_family)}" placeholder="e.g. Data Scientist" required></label>
    </div>
    <label class="field">Posting text <textarea name="text" rows="6" class="mono-input" required minlength="200">${esc(jd.text)}</textarea></label>
  </div>`;

Views.progress = (steps, active) => `
  <div class="card loader" aria-live="polite">
    ${steps.map((s, i) => `<div class="loader-step ${i < active ? "done" : i === active ? "active" : ""}">${esc(s)}</div>`).join("")}
    <p class="small muted">Real model calls; this can take up to a minute.</p>
  </div>`;

function proposalBanner(proposal) {
  if (!proposal) return "";
  const d = proposal.diff;
  return `<div class="proposal-banner"><div><strong>The agent proposed plan v${proposal.version}</strong>
    <div class="small">${esc(proposal.reason)}</div>
    <div class="small muted">${d.changed.length} changed · ${d.added.length} added · ${d.removed.length} removed · ${(d.rescheduled || []).length} rescheduled. Waiting for your decision.</div></div>
    <a class="btn primary" href="#/plan">Review change</a></div>`;
}

Views.overview = (s) => {
  const ledger = s.ledger;
  const count = (fn) => ledger.filter(fn).length;
  const shown = count((r) => r.level === "demonstrated" || r.level === "artifact_backed");
  const claimed = count((r) => r.level === "claimed");
  const none = count((r) => r.level === "none");
  const firstItem = s.plan?.plan?.weeks?.[0]?.items?.[0];
  return `
  <div class="page-head"><div><div class="eyebrow">Pivoting to</div><h1>${esc(s.profile.target_role)}</h1>
    <p>Grounded in ${s.jds.length} job descriptions: ${s.jds.map((j) => esc(j.company)).join(", ")}.</p></div>
    <span class="small muted">Plan v${s.plan?.version ?? "–"} · ${s.profile.hours_per_week} h/week</span></div>
  <div class="stack">
    ${proposalBanner(s.proposal)}
    <div class="stats">
      <div class="stat"><div class="stat-num">${ledger.length}</div><div class="stat-label">Skills the postings ask for</div></div>
      <div class="stat"><div class="stat-num">${shown}</div><div class="stat-label">Demonstrated or artifact-backed</div></div>
      <div class="stat"><div class="stat-num">${claimed}</div><div class="stat-label">Claimed only, unproven</div></div>
      <div class="stat"><div class="stat-num">${none}</div><div class="stat-label">No evidence yet</div></div>
    </div>
    <div class="grid-2">
      <div class="card next-card stack-s">
        <div class="eyebrow">Next best step</div>
        ${firstItem ? `<h2>${esc(firstItem.skill)}: ${esc(firstItem.action)}</h2><p class="muted">${esc(firstItem.detail)}</p>
        <p class="small muted">Why: asked for in ${esc(firstItem.why.demand)}; current evidence: ${esc(LEVEL_LABEL[firstItem.why.level])}.</p>` : "<p>No open gaps in the plan.</p>"}
        <div class="row"><button class="btn accent" data-action="agent-next" type="button">Let the agent pick my next assessment</button></div>
      </div>
      <div class="card stack-s">
        <div class="eyebrow">Highest-priority gaps</div>
        ${ledger.slice(0, 6).map((r) => `<div class="spread"><button class="skill-btn" data-action="open-skill" data-skill="${esc(r.skill_id)}">${esc(r.name)}</button>${ladder(r)}</div>`).join("")}
        <a class="small" href="#/ledger">Open the full ledger →</a>
      </div>
    </div>
    ${s.rejected_count ? `<p class="small muted">${s.rejected_count} extracted item(s) were rejected because their quotes could not be found in your text. <button class="link-btn" data-action="show-rejected">See them</button></p>` : ""}
    <p class="small muted">ProofPath records evidence. It does not certify that anyone is ready for a job.</p>
  </div>`;
};

Views.ledger = (s, filter) => {
  const rows = s.ledger.filter((r) => filter === "all" || r.level === filter || (filter === "contested" && r.contested));
  const chip = (value, label) => `<button class="btn ${filter === value ? "primary" : ""}" data-action="filter" data-filter="${value}" type="button">${label}</button>`;
  return `
  <div class="page-head"><div><div class="eyebrow">Evidence ledger</div><h1>What you can prove, skill by skill</h1>
  <p>Each row is a skill your target postings ask for. Priority = demand across postings × evidence gap${s.ledger.some((r) => r.response_weight !== 1) ? " × response adjustment" : ""}. Click a skill to see every quote and event behind it.</p></div></div>
  <div class="row" style="margin-bottom:14px">${chip("all", "All")}${chip("none", "No evidence")}${chip("claimed", "Claimed")}${chip("contested", "Contested")}${chip("partial", "Partial")}${chip("demonstrated", "Demonstrated")}${chip("artifact_backed", "Artifact-backed")}</div>
  ${rows.length ? `<div class="table-wrap"><table>
    <thead><tr><th scope="col">Skill</th><th scope="col">Evidence</th><th scope="col">Certainty</th><th scope="col">Demand</th><th scope="col">Priority</th><th scope="col">Last check</th></tr></thead>
    <tbody>${rows.map((r) => `<tr class="clickable" data-action="open-skill" data-skill="${esc(r.skill_id)}">
      <td><button class="skill-btn" data-action="open-skill" data-skill="${esc(r.skill_id)}">${esc(r.name)}</button></td>
      <td>${ladder(r)} <span class="small muted mono">${strength(r.strength)}</span></td>
      <td>${uncertaintyTag(r.uncertainty)}</td>
      <td class="small">${r.demand.jd_count}/${r.demand.jd_total} postings${r.demand.must_count ? ` · ${r.demand.must_count} must` : ""}</td>
      <td class="mono small">${r.priority.toFixed(3)}</td>
      <td>${r.last_outcome ? tag(r.last_outcome, r.last_outcome) : '<span class="muted small">–</span>'}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No skills match this filter.</div>`}`;
};

Views.skillDrawer = (k) => `
  <div class="drawer-head"><div><div class="eyebrow">Skill</div><h2 id="drawer-title">${esc(k.name)}</h2>
    <div class="row" style="margin-top:8px">${ladder(k)} ${uncertaintyTag(k.uncertainty)} <span class="small muted mono">strength ${strength(k.strength)}</span></div></div>
    <button class="btn ghost" data-action="close-drawer" aria-label="Close">✕</button></div>
  <ul class="small" style="margin:0;padding-left:18px">${k.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
  <div class="row"><button class="btn accent" data-action="assess-skill" data-skill="${esc(k.skill_id)}" type="button">Assess this skill</button>
    <span class="small muted">Priority ${k.priority.toFixed(3)} · ${k.demand.jd_count}/${k.demand.jd_total} postings</span></div>
  <section><div class="section-title">Why the postings want it (${k.requirements.length})</div><div class="stack-s">
    ${k.requirements.map((q) => `<div><div class="quote verified">${esc(q.quote)}</div><div class="source">${esc(q.title)} · ${esc(q.company)} · ${q.importance === "must" ? "must-have" : "nice-to-have"} · quote verified in posting</div></div>`).join("") || '<p class="muted small">No posting asks for this skill.</p>'}
  </div></section>
  <section><div class="section-title">Resume evidence (${k.claims.length})</div><div class="stack-s">
    ${k.claims.map((c) => `<div><div class="quote claim">${esc(c.quote)}</div><div class="source">Verified in resume · ${c.match === "explicit" ? "names the skill" : "inferred link, skill not named"} · counts as a claim, not proof</div></div>`).join("") || '<p class="muted small">No resume passage supports this skill. Nothing was invented to fill the gap.</p>'}
  </div></section>
  <section><div class="section-title">Assessments (${k.assessments.length})</div><div class="stack-s">
    ${k.assessments.map((a) => `<div class="card" style="padding:12px"><div class="spread"><span class="small">${esc(a.question.slice(0, 140))}…</span>${a.status === "graded" ? tag(`${a.outcome} ${a.total}/${a.max_total}`, a.outcome) : tag("open")}</div>
      ${a.status === "graded" ? `<div class="small muted" style="margin-top:6px">${a.criteria.map((c) => `${esc(c.criterion)}: ${esc(c.rating.replace("_", " "))}`).join(" · ")}</div>` : ""}</div>`).join("") || '<p class="muted small">Not assessed yet.</p>'}
  </div></section>
  <section><div class="section-title">Artifacts (${k.artifacts.length})</div><div class="stack-s">
    ${k.artifacts.map((a) => `<div class="spread small"><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.url)}</a>${tag(a.review_status, a.review_status)}</div>`).join("") || '<p class="muted small">No artifacts linked.</p>'}
  </div></section>
  <section><div class="section-title">Evidence events</div><div class="timeline">
    ${k.events.map((e) => `<div class="event"><span class="event-id">#${e.id}</span><div><strong>${esc(e.kind.replace(/_/g, " "))}</strong> · ${esc(LEVEL_LABEL[e.before_level])} → ${esc(LEVEL_LABEL[e.after_level])} <span class="mono muted">(${strength(e.before_strength)} → ${strength(e.after_strength)})</span><div class="muted">${esc(e.note)} · ${esc(fmtTime(e.created_at))}</div></div></div>`).join("") || '<p class="muted small">No events yet.</p>'}
  </div></section>`;

function planItem(i) {
  return `<div class="item"><div class="item-top"><strong>${esc(i.skill)}</strong><span class="mono small muted">${i.hours}h</span></div>
    <span class="action ${esc(i.action)}">${esc(i.action)}${i.part > 1 ? " (cont.)" : ""}</span>
    <span class="small muted">${esc(i.detail)}</span></div>`;
}

function diffValue(field, value) {
  if (field === "first_week") return value ? `week ${value}` : "backlog";
  if (field === "hours") return `${value}h`;
  return esc(value);
}

Views.diff = (d) => `
  <div class="diff">
    <div class="diff-col removed"><h4>Removed (${d.removed.length})</h4>${d.removed.map((r) => `<div class="diff-entry"><strong>${esc(r.skill)}</strong><div class="before">${esc(r.action)} · ${r.hours}h</div></div>`).join("") || '<span class="small muted">None</span>'}</div>
    <div class="diff-col changed"><h4>Changed (${d.changed.length})</h4>${d.changed.map((c) => `<div class="diff-entry"><strong>${esc(c.skill)}</strong>${Object.entries(c.fields)
      .filter(([f]) => !(f === "detail" && c.fields.action))
      .map(([f, v]) => `<div><span class="muted">${esc(f.replace("_", " "))}:</span> <span class="before">${diffValue(f, v.before)}</span> → <span class="after">${diffValue(f, v.after)}</span></div>`).join("")}
      ${c.fields.action ? `<div class="muted" style="margin-top:4px">${esc(c.fields.detail ? c.fields.detail.after : "")}</div>` : ""}</div>`).join("") || '<span class="small muted">None</span>'}</div>
    <div class="diff-col added"><h4>Added (${d.added.length})</h4>${d.added.map((a) => `<div class="diff-entry"><strong>${esc(a.skill)}</strong><div class="after">${esc(a.action)} · ${a.hours}h</div></div>`).join("") || '<span class="small muted">None</span>'}</div>
  </div>
  ${(d.rescheduled || []).length ? `<p class="small muted">Knock-on schedule shifts: ${d.rescheduled.map((r) => `${esc(r.skill)} (${diffValue("first_week", r.before)} → ${diffValue("first_week", r.after)})`).join(", ")}</p>` : ""}`;

Views.plan = (p) => {
  const active = p.active;
  return `
  <div class="page-head"><div><div class="eyebrow">Learning plan</div><h1>Week by week, computed from the ledger</h1>
  <p>The plan is recalculated by code from your evidence. The agent can only propose a change when new evidence alters it, and nothing changes until you accept.</p></div></div>
  <div class="stack">
  ${p.proposal ? `<div class="card raised stack">
    <div class="spread"><div><div class="eyebrow">Proposed by the agent · v${p.proposal.base_version} → v${p.proposal.version}</div><h2>${esc(p.proposal.reason)}</h2>
    <p class="small muted">Trigger: ${esc(p.proposal.trigger.replace(/_/g, " "))} · cites evidence event${p.proposal.cited_events.length === 1 ? "" : "s"} ${p.proposal.cited_events.map((id) => `#${id}`).join(", ") || "(application statistics)"}</p></div>
    <div class="row"><button class="btn" data-action="reject-proposal" data-id="${p.proposal.id}">Reject</button><button class="btn accent" data-action="accept-proposal" data-id="${p.proposal.id}">Accept change</button></div></div>
    ${Views.diff(p.proposal.diff)}</div>` : ""}
  ${active ? `<div class="spread"><h2>Active plan · v${active.version}</h2><span class="small muted">${active.plan.hours_per_week} h/week · ${esc(active.reason)}</span></div>
  <div class="weeks">${active.plan.weeks.map((w) => `<div class="week"><div class="week-head"><span>Week ${w.week}</span><span>${w.items.reduce((n, i) => n + i.hours, 0)}h</span></div>${w.items.map(planItem).join("")}</div>`).join("")}</div>
  ${active.plan.backlog.length ? `<p class="small muted">Backlog after week ${active.plan.weeks.length}: ${active.plan.backlog.map((b) => esc(b.skill)).join(", ")}</p>` : ""}` : '<div class="empty">No plan yet.</div>'}
  <section><div class="section-title">Version history</div><div class="table-wrap"><table><thead><tr><th>Version</th><th>Status</th><th>Trigger</th><th>Reason</th><th>When</th></tr></thead><tbody>
  ${p.versions.map((v) => `<tr><td class="mono">v${v.version}</td><td>${tag(v.status, v.status === "active" ? "pass" : v.status === "proposed" ? "high" : v.status === "rejected" ? "fail" : "")}</td><td class="small">${esc(v.trigger.replace(/_/g, " "))}</td><td class="small">${esc(v.reason)}</td><td class="small muted">${esc(fmtTime(v.created_at))}</td></tr>`).join("")}
  </tbody></table></div></section></div>`;
};

Views.question = (a) => `
  <div class="card raised stack">
    <div class="spread"><div><div class="eyebrow">Mock interview · ${esc(a.skill_name)}</div>
    <p class="small muted">Chosen by ${a.selected_by === "agent" ? "the agent" : "you"}: ${esc(a.selection_reason)}</p></div>${tag("open")}</div>
    <p class="question">${esc(a.question)}</p>
    <form id="answer-form" class="stack-s" data-id="${a.id}">
      <label class="field">Your answer <textarea name="answer" rows="9" required placeholder="Explain your reasoning as you would to an interviewer. Specifics beat buzzwords."></textarea></label>
      <div class="spread"><span class="small muted" id="word-count">0 words · aim for 150–300</span><button class="btn primary" type="submit" id="answer-submit">Submit for grading</button></div>
    </form>
    <details class="small"><summary>Rubric (fixed before you answer)</summary><ul>
      <li><strong>Correctness</strong>: core technical claims are accurate.</li><li><strong>Depth</strong>: explains why, with a trade-off or failure mode.</li>
      <li><strong>Application</strong>: a concrete scenario with steps or numbers.</li><li><strong>Precision</strong>: terms used correctly in relation to each other.</li></ul>
      <p class="muted">Every “met” must quote your own words. Quotes are checked in code; unsupported ratings are downgraded.</p></details>
  </div>`;

const FLAG_TEXT = {
  keyword_stuffing: "Looks like a list of terms rather than reasoning, so it cannot pass.",
  too_short: "Too short to demonstrate the skill, so it cannot pass.",
  prompt_injection_ignored: "Instructions inside the answer were ignored and cannot be quoted as evidence.",
};

Views.result = (r) => {
  const a = r.assessment;
  return `
  <div class="card raised stack">
    <div class="spread"><div><div class="eyebrow">Result · ${esc(a.skill_name)}</div><h2>${esc(a.feedback || "")}</h2></div>
      <div style="text-align:right"><div class="score">${a.total}<span class="muted" style="font-size:1rem">/${a.max_total}</span></div>${tag(a.outcome, a.outcome)}</div></div>
    ${r.duplicate ? '<p class="small muted">This exact answer was already graded; no new evidence was recorded.</p>' : ""}
    ${a.flags.map((f) => `<div class="flag">${esc(FLAG_TEXT[f] || f)}</div>`).join("")}
    <div class="criteria">${a.criteria.map((c) => `<div class="criterion"><strong class="small">${esc(c.criterion)}</strong><span>${tag(c.rating.replace("_", " "), c.rating === "met" ? "pass" : c.rating === "partial" ? "partial" : "fail")}</span>
      <div class="stack-s">${c.evidence_quote ? `<div class="quote ${c.verification === "verified" ? "verified" : "bad"}">${esc(c.evidence_quote)}</div>` : ""}<span class="small">${esc(c.feedback)}</span>
      ${c.verification !== "n/a" && c.verification !== "verified" ? `<span class="small" style="color:var(--contested)">${esc(c.verification)}</span>` : ""}</div></div>`).join("")}</div>
    <p class="small muted">Total and outcome are computed in code from the verified ratings (met = 2, partial = 1). Pass needs 6+ with correctness met.</p>
    ${r.agent && r.agent.error ? `<div class="flag">Grading was saved, but the agent step failed: ${esc(r.agent.error)}</div>` : ""}
    ${r.proposal ? `<div class="proposal-banner"><div><strong>This evidence changed your plan.</strong><div class="small">${esc(r.proposal.reason)}</div></div><a class="btn primary" href="#/plan">See before / after</a></div>`
      : r.duplicate ? "" : '<p class="small muted">The agent reviewed this result and found no plan change to propose.</p>'}
    <div class="row"><button class="btn" data-action="agent-next">Next assessment</button><button class="btn ghost" data-action="open-skill" data-skill="${esc(a.skill_id)}">Open skill evidence</button></div>
  </div>`;
};

Views.assess = (list, current, result) => {
  const graded = list.filter((a) => a.status === "graded");
  return `
  <div class="page-head"><div><div class="eyebrow">Assessments</div><h1>Turn claims into demonstrated evidence</h1>
  <p>The agent picks the skill where new evidence would matter most. Grading uses a fixed four-part rubric, and every rating must quote your answer.</p></div>
  <button class="btn accent" data-action="agent-next" type="button">Let the agent pick</button></div>
  <div class="stack">
  ${result ? Views.result(result) : current ? Views.question(current) : '<div class="empty">No open question. Let the agent choose one, or open a skill in the ledger and assess it.</div>'}
  ${graded.length ? `<section><div class="section-title">History</div><div class="table-wrap"><table><thead><tr><th>Skill</th><th>Outcome</th><th>Score</th><th>Flags</th><th>When</th></tr></thead><tbody>
  ${graded.map((a) => `<tr><td><button class="skill-btn" data-action="open-skill" data-skill="${esc(a.skill_id)}">${esc(a.skill_name)}</button></td><td>${tag(a.outcome, a.outcome)}</td><td class="mono">${a.total}/${a.max_total}</td><td class="small">${a.flags.map(esc).join(", ") || "–"}</td><td class="small muted">${esc(fmtTime(a.answered_at))}</td></tr>`).join("")}
  </tbody></table></div></section>` : ""}</div>`;
};

Views.projects = (projects) => `
  <div class="page-head"><div><div class="eyebrow">Portfolio projects</div><h1>Projects that close specific gaps</h1>
  <p>Suggestions target your highest-priority gaps. A linked repo counts for nothing until its README or code excerpt passes review against the acceptance criteria, with quotes checked in code.</p></div>
  <button class="btn accent" data-action="generate-projects" type="button">${projects.length ? "Regenerate suggestions" : "Suggest projects"}</button></div>
  ${projects.length ? `<div class="grid-2">${projects.map((p) => `<div class="card stack-s">
    <h2>${esc(p.title)}</h2><p class="small">${esc(p.brief)}</p>
    <div class="row">${p.skills.map((s) => `<button class="tag" data-action="open-skill" data-skill="${esc(s.skill_id)}">${esc(s.name)}</button>`).join("")}</div>
    <div class="section-title" style="margin:8px 0 0">Acceptance criteria</div><ul class="small" style="margin:0;padding-left:18px">${p.acceptance.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
    ${p.artifacts.map((a) => `<div class="card" style="padding:12px"><div class="spread small"><a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.url)}</a>${tag(a.review_status, a.review_status)}</div>
      ${a.review ? `<p class="small muted" style="margin-top:6px">${esc(a.review.summary)} (${a.review.met}/${a.review.of} criteria with verified quotes)</p>` : `<button class="btn" style="margin-top:8px" data-action="review-artifact" data-id="${a.id}">Review against criteria</button>`}</div>`).join("")}
    <form class="stack-s artifact-form" data-project="${p.id}">
      <label class="field">Artifact URL <input type="url" name="url" required placeholder="https://github.com/you/project"></label>
      <label class="field">README or code excerpt (links are not fetched) <textarea name="submitted_text" rows="4" class="mono-input"></textarea></label>
      <button class="btn" type="submit">Link artifact</button></form>
  </div>`).join("")}</div>` : '<div class="empty">No suggestions yet.</div>'}`;

Views.applications = (data, families) => {
  const ins = data.insights;
  return `
  <div class="page-head"><div><div class="eyebrow">Applications</div><h1>What responses actually tell you</h1>
  <p>Log where you applied and what happened. ProofPath only changes priorities when response rates by role type separate beyond their uncertainty.</p></div></div>
  <div class="stack">
  <div class="card stack-s"><div class="eyebrow">Feedback</div><p>${esc(ins.message)}</p>
    ${ins.families.length ? `<div class="table-wrap"><table><thead><tr><th>Role type</th><th>Applied</th><th>Outcomes</th><th>Responses</th><th>Response rate (95% interval)</th></tr></thead><tbody>
    ${ins.families.map((f) => `<tr><td>${esc(f.role_family)}</td><td>${f.applied}</td><td>${f.outcomes}</td><td>${f.responded}</td><td class="mono small">${f.response_rate === null ? "–" : `${Math.round(f.response_rate * 100)}% (${Math.round(f.ci_low * 100)}–${Math.round(f.ci_high * 100)}%)`}</td></tr>`).join("")}</tbody></table></div>` : ""}</div>
  <form id="app-form" class="card"><div class="grid-3">
    <label class="field">Company <input type="text" name="company" required></label>
    <label class="field">Role title <input type="text" name="role_title" required></label>
    <label class="field">Role type <input type="text" name="role_family" list="families" required><datalist id="families">${families.map((f) => `<option value="${esc(f)}">`).join("")}</datalist></label></div>
    <div class="row" style="margin-top:12px"><label class="field">Status <select name="status"><option value="applied">Applied</option><option value="no_response">No response</option><option value="rejected">Rejected</option><option value="interview">Interview</option><option value="offer">Offer</option></select></label>
    <button class="btn primary" type="submit" style="align-self:flex-end">Log application</button></div></form>
  ${data.applications.length ? `<div class="table-wrap"><table><thead><tr><th>Company</th><th>Role</th><th>Type</th><th>Status</th></tr></thead><tbody>
  ${data.applications.map((a) => `<tr><td>${esc(a.company)}</td><td>${esc(a.role_title)}</td><td>${esc(a.role_family)}</td><td><select data-action="app-status" data-id="${a.id}" aria-label="Status for ${esc(a.company)}">${["applied", "no_response", "rejected", "interview", "offer"].map((s) => `<option value="${s}" ${s === a.status ? "selected" : ""}>${s.replace("_", " ")}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div>` : ""}
  </div>`;
};

function logDetail(e) {
  const d = e.detail;
  if (e.action === "summary") return esc(d.text);
  if (e.action === "agent_started") return esc(d.context);
  if (d.input || d.result) return `<span class="mono">${esc(JSON.stringify(d.input || {}))}</span> → <span class="mono">${esc(JSON.stringify(d.result || {}).slice(0, 400))}</span>`;
  return `<span class="mono">${esc(JSON.stringify(d).slice(0, 400))}</span>`;
}

Views.activity = (entries) => {
  const runs = [];
  for (const e of entries.slice().reverse()) {
    const last = runs[runs.length - 1];
    if (last && last.run_id === e.run_id) last.items.push(e);
    else runs.push({ run_id: e.run_id, trigger: e.trigger, items: [e] });
  }
  return `
  <div class="page-head"><div><div class="eyebrow">Agent activity</div><h1>Every decision, every tool call</h1>
  <p>The coach agent acts only through tools. Code validates each call; rejected calls are shown with their error.</p></div></div>
  ${runs.length ? `<div class="stack">${runs.reverse().map((r) => `<div class="run"><div class="spread"><strong>${esc(r.trigger.replace(/_/g, " "))}</strong><span class="small muted mono">run ${esc(r.run_id)} · ${esc(fmtTime(r.items[0].ts))}</span></div>
    ${r.items.map((e) => `<div class="log-line"><span class="small muted">${esc(e.actor)}</span><strong class="small">${esc(e.action.replace(/_/g, " "))}</strong><span class="small">${logDetail(e)}</span></div>`).join("")}</div>`).join("")}</div>` : '<div class="empty">No activity yet.</div>'}`;
};

Views.rejected = (items) => `
  <div class="drawer-head"><div><div class="eyebrow">Rejected extractions</div><h2 id="drawer-title">Quotes that failed verification</h2></div><button class="btn ghost" data-action="close-drawer" aria-label="Close">✕</button></div>
  <p class="small muted">The model proposed these, but code could not find the quoted text in your documents, so they were discarded.</p>
  <div class="stack-s">${items.map((r) => `<div><div class="quote bad">${esc(r.quote)}</div><div class="source">${esc(r.skill_name)} · ${esc(r.source)} · ${esc(r.reason)}</div></div>`).join("")}</div>`;
