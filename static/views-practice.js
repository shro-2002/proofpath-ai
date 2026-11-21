/* Practice: focused challenge, staged grading, results, and the evidence → roadmap moment. */
"use strict";

const RUBRIC_ITEMS = [
  ["Correctness", "Core technical claims are accurate."],
  ["Depth", "Explains why, with a trade-off or failure mode."],
  ["Application", "A concrete scenario with steps or numbers."],
  ["Precision", "Terms used correctly in relation to each other."],
];
const TARGET_WORDS = 150;

const FLAG_TEXT = {
  keyword_stuffing: "This reads like a list of terms rather than reasoning, so it cannot pass.",
  too_short: "Too short to demonstrate the skill, so it cannot pass.",
  prompt_injection_ignored: "Instructions inside the answer were ignored and cannot be quoted as evidence.",
};

Views.practiceTabs = (active) => `<nav class="subnav" aria-label="Practice">
  <a href="#/practice" ${active === "practice" ? 'aria-current="page"' : ""}>Assessments</a>
  <a href="#/projects" ${active === "projects" ? 'aria-current="page"' : ""}>Portfolio projects</a></nav>`;

Views.question = (a) => `
  <div class="challenge">
    <section class="card raised challenge-main">
      <div class="spread"><span class="eyebrow ai">${icon("target")} Assessment · ${esc(a.skill_name)}</span><span class="meta-row" style="margin:0"><span>${icon("clock")}About 10 minutes</span></span></div>
      <p class="question">${esc(a.question)}</p>
      <form id="answer-form" data-id="${a.id}">
        <label class="sr-only" for="answer">Your answer</label>
        <div class="editor"><textarea id="answer" name="answer" required placeholder="Explain it the way you would to an interviewer. Concrete steps, numbers and trade-offs beat buzzwords."></textarea>
          <div class="editor-foot"><span class="wc"><span id="word-count">0 words</span><div class="meter ai" id="wc-meter" role="presentation"><span style="width:2%"></span></div><span>aim for 150–300</span></span>
            <button class="btn primary" type="submit" id="answer-submit">Submit for grading ${icon("arrow")}</button></div></div>
      </form>
    </section>
    <aside class="side-card">
      <div class="card stack-s"><div class="eyebrow">Why this skill</div>
        <p class="small">${esc(a.selection_reason)}</p>
        <span class="small muted">Chosen by ${a.selected_by === "agent" ? "your AI coach" : "you"}.</span></div>
      <div class="card stack-s"><div class="eyebrow">How it's graded</div>
        ${RUBRIC_ITEMS.map(([t, d], i) => `<div class="rubric-item"><span class="num">${i + 1}</span><div><b>${t}</b><span class="muted">${d}</span></div></div>`).join("")}
        <p class="small muted">Fixed before you answer. Every "met" must quote your own words, and code checks the quote. Met = 2, partial = 1; pass needs 6 of 8 with correctness met.</p></div>
    </aside>
  </div>`;

const GRADING_STAGES = ["Grading against the rubric", "Checking every quoted span in code", "Updating your evidence ledger", "Coach is reviewing your roadmap"];

Views.grading = (skill) => `
  <section class="card raised grading">
    <div class="eyebrow ai"><span class="spinner" aria-hidden="true" style="display:inline-block;vertical-align:-2px;margin-right:6px"></span>Evaluating · ${esc(skill)} · <span id="elapsed" role="timer">0 s</span></div>
    <h2 style="margin-top:8px">Reading your answer carefully</h2>
    <p class="small muted" style="margin-top:8px">One request runs all of these on the server, in order. Results appear when it finishes, usually in 15–40 seconds.</p>
    ${processList(GRADING_STAGES)}
  </section>`;

function criterionCard(c) {
  const tone = c.rating === "met" ? "ok" : c.rating === "partial" ? "warn" : "gap";
  const unverified = c.verification && c.verification !== "n/a" && c.verification !== "verified";
  return `<div class="criterion ${esc(c.rating)}">
    <div class="spread"><strong class="small" style="text-transform:capitalize">${esc(c.criterion)}</strong>${tag(humanize(c.rating), tone)}</div>
    ${c.evidence_quote ? `<div class="quote ${unverified ? "bad" : "verified"}">${esc(c.evidence_quote)}</div>` : ""}
    <span class="small">${esc(c.feedback)}</span>
    ${unverified ? `<span class="small" style="color:var(--gap)">${icon("alert")} ${esc(c.verification)}: rating downgraded</span>` : ""}</div>`;
}

function ledgerShift(shift) {
  if (!shift || !shift.before || !shift.after) return "";
  const side = (row, label) => `<div class="side"><span class="eyebrow">${label}</span>${levelBadge(row)}${strengthMeter(row)}<span class="mono small muted">strength ${strength(row.strength)}</span></div>`;
  return `<div class="ledger-shift">${side(shift.before, "Before")}<span class="arrow">${icon("arrow")}</span>${side(shift.after, "After")}</div>`;
}

function wowPanel(r, shift) {
  const a = r.assessment;
  if (r.duplicate) return "";
  const moved = shift && shift.before && shift.after && (shift.before.level !== shift.after.level || shift.before.strength !== shift.after.strength);
  if (r.decision) {
    return `<section class="card stack-s"><div class="eyebrow ai">Evidence recorded · event #${esc(r.event_id)}</div>${moved ? ledgerShift(shift) : ""}
      <p>${icon("checkCircle")} ${esc(r.decision)} <a href="#/roadmap">Open roadmap</a></p></section>`;
  }
  if (r.proposal) {
    const p = r.proposal;
    return `<section class="card wow stack">
      <div class="wow-head"><span class="icon-wrap">${icon("sparkle")}</span><div><div class="eyebrow ai">New evidence recorded · event #${esc(r.event_id)}</div>
        <h2>Your roadmap has a recommended update</h2></div></div>
      ${ledgerShift(shift)}
      <p><strong>Why:</strong> ${esc(p.reason)}</p>
      ${Views.diff(p.diff)}
      <div class="spread"><span class="small muted">Plan v${p.base_version} stays active until you accept. Cites ${p.cited_events.map((id) => `<span class="cite">#${id}</span>`).join(" ") || "no events"}.</span>
        <div class="row"><button class="btn" data-action="reject-proposal" data-id="${p.id}">Keep current plan</button><button class="btn primary" data-action="accept-proposal" data-id="${p.id}">${icon("check")} Accept update</button></div></div>
    </section>`;
  }
  return `<section class="card stack-s">
    <div class="eyebrow">${moved ? `Evidence recorded · event #${esc(r.event_id)}` : "Evidence recorded"}</div>
    ${moved ? ledgerShift(shift) : ""}
    <p class="small muted">${r.agent && r.agent.error ? "" : `Your coach reviewed this ${esc(a.skill_name)} result and found no roadmap change worth proposing.`}</p></section>`;
}

/* Scores at or above the pass line can still be partial: a pass also requires correctness to be met. */
function notPassReason(a) {
  const correctness = a.criteria.find((c) => c.criterion === "correctness");
  if (a.outcome === "pass" || a.total < 6 || !correctness || correctness.rating === "met") return "";
  return `<p class="small"><strong>Why not a pass:</strong> ${a.total} of ${a.max_total} points, but correctness was rated ${esc(humanize(correctness.rating))}. A pass needs 6 or more points with correctness met.</p>`;
}

Views.result = (r, shift) => {
  const a = r.assessment;
  const pct = Math.round((a.total / a.max_total) * 100);
  const ringColor = { pass: "var(--proof-fill)", partial: "var(--warn-fill)", fail: "var(--gap-fill)" }[a.outcome];
  const met = a.criteria.filter((c) => c.rating === "met");
  const missed = a.criteria.filter((c) => c.rating !== "met");
  return `<div class="stack">
    <section class="card raised outcome view-enter">
      <div class="ring" style="--p:${pct};--c:${ringColor}"><div><div><b>${a.total}</b><span>/ ${a.max_total}</span></div></div></div>
      <div class="stack-s"><div class="row"><span class="eyebrow">Result · ${esc(a.skill_name)}</span>${outcomeTag(a.outcome)}</div>
        <p class="result-feedback">${esc(a.feedback || "")}</p>
        <p class="small muted">${met.length ? `Strengths shown: ${esc(met.map((c) => c.criterion).join(", "))}. ` : ""}${missed.length ? `Practise next: ${esc(missed.map((c) => c.criterion).join(", "))}.` : "Every criterion met."}</p>
        ${notPassReason(a)}
        <p class="small muted">An AI-graded practice check recorded as evidence. It is not a professional certification.</p></div>
    </section>
    ${r.duplicate ? `<div class="flag">${icon("alert")}<span>This exact answer was already graded, so no new evidence was recorded.</span></div>` : ""}
    ${a.flags.map((f) => `<div class="flag gap">${icon("alert")}<span>${esc(FLAG_TEXT[f] || f)}</span></div>`).join("")}
    ${r.agent && r.agent.error ? `<div class="flag gap">${icon("alert")}<span>Your result was saved, but the coach step failed: ${esc(r.agent.error)}</span></div>` : ""}
    ${wowPanel(r, shift)}
    <section><div class="section-title">Rubric breakdown</div><div class="criteria">${a.criteria.map(criterionCard).join("")}</div></section>
    <div class="row"><button class="btn primary" data-action="agent-next">${icon("sparkle")} Next assessment</button><button class="btn" data-action="open-skill" data-skill="${esc(a.skill_id)}">See ${esc(a.skill_name)} evidence</button></div>
  </div>`;
};

function historyTable(graded) {
  if (!graded.length) return "";
  return `<section><div class="section-title">History</div><div class="table-wrap"><table><thead><tr><th>Skill</th><th>Outcome</th><th>Score</th><th>Flags</th><th>When</th></tr></thead><tbody>
    ${graded.slice().reverse().map((a) => `<tr><td><button class="skill-btn" data-action="open-skill" data-skill="${esc(a.skill_id)}">${esc(a.skill_name)}</button></td><td>${outcomeTag(a.outcome)}</td><td class="mono">${a.total}/${a.max_total}</td><td class="small">${a.flags.map((f) => esc(humanize(f))).join(", ") || "–"}</td><td class="small muted">${esc(fmtTime(a.answered_at))}</td></tr>`).join("")}
  </tbody></table></div></section>`;
}

Views.practice = (list, current, result, shift, state) => {
  const graded = list.filter((a) => a.status === "graded");
  const main = result
    ? Views.result(result, shift)
    : current
      ? Views.question(current)
      : nextStepCard(state, { heading: "Your next planned step" });
  return `<div class="view-enter">${Views.practiceTabs("practice")}
    <div class="page-head"><div><div class="eyebrow">Practice</div><h1>Turn claims into proof</h1>
      <p>Short written checks graded on a fixed four-part rubric. A pass moves a skill from claimed to demonstrated in your ledger.</p></div>
      ${current || result ? `<button class="btn" data-action="agent-next" type="button">${icon("sparkle")} New question</button>` : ""}</div>
    <div class="stack"><div id="practice-main">${main}</div>${historyTable(graded)}</div></div>`;
};
