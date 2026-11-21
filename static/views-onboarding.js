/* Onboarding views: inspire → goal → experience → market → build → reveal. Pure templates. */
"use strict";

const Views = {};

const OB_STEPS = ["Your goal", "Your experience", "Job postings", "Your results"];
const ROLE_CHOICES = ["Data Scientist", "Data Analyst", "ML Engineer", "Product Manager", "Software Engineer", "UX Designer"];
const RECOMMENDED_POSTINGS = 3;

function obShell(step, body, foot = "") {
  const steps = step > 0
    ? `<ol class="steps" aria-label="Onboarding progress">${OB_STEPS.map((s, i) => {
      const n = i + 1;
      const cls = n < step ? "done" : n === step ? "now" : "";
      return `<li class="${cls}" ${n === step ? 'aria-current="step"' : ""}><span>${esc(s)}</span></li>`;
    }).join("")}</ol>`
    : "";
  return `<div class="ob view-enter">
    <div class="ob-top"><span class="brand"><span class="brand-mark" aria-hidden="true"></span><span class="brand-name">ProofPath</span></span>${steps}</div>
    <div class="ob-body">${body}</div>${foot}</div>`;
}

function obWhy(text) {
  return `<div class="ob-why">${icon("sparkle")}<span>${esc(text)}</span></div>`;
}

function obFoot(back, nextLabel, nextAction = "ob-next") {
  return `<div class="ob-foot">
    ${back ? `<button class="btn ghost" type="button" data-action="ob-back">Back</button>` : "<span></span>"}
    <button class="btn primary lg" type="button" data-action="${nextAction}">${esc(nextLabel)} ${icon("arrow")}</button></div>`;
}

Views.obWelcome = () => obShell(0, `
  <section class="hero-ob">
    <div>
      <div class="eyebrow ai">Evidence-driven career transitions</div>
      <h1 style="margin-top:14px">Your experience is worth <em>more than your resume shows.</em></h1>
      <p class="lede">Discover what you can already prove, what employers still need, and your smartest next career move.</p>
      <div class="row">
        <button class="btn primary lg" type="button" data-action="ob-start">Map my evidence ${icon("arrow")}</button>
        <button class="btn lg" type="button" data-action="ob-sample">Explore with a sample profile</button>
      </div>
      <div class="promise">
        <div>${icon("checkCircle")}Every skill is traced to a quote from a real posting</div>
        <div>${icon("checkCircle")}Resume claims stay claims until you pass a check</div>
        <div>${icon("checkCircle")}Your plan only changes when you approve it</div>
      </div>
    </div>
    <div class="specimen" aria-label="Example of an evidence ledger">
      <div class="eyebrow">What you get · example</div>
      <div class="spec-row"><span>SQL</span>${levelBadge({ level: "demonstrated" })}${meter(0.65)}</div>
      <div class="spec-row"><span>Python</span>${levelBadge({ level: "claimed" })}${meter(0.25, "warn")}</div>
      <div class="spec-row"><span>A/B testing</span>${levelBadge({ level: "none" })}${meter(0.02, "gap")}</div>
      <div class="spec-row"><span>Dashboards</span>${levelBadge({ level: "artifact_backed" })}${meter(0.85)}</div>
      <p class="spec-note">Illustration only. Your ledger is built from your own resume and postings.</p>
    </div>
  </section>`);

Views.obGoal = (d) => {
  const isCustom = d.target_role && !ROLE_CHOICES.includes(d.target_role);
  return obShell(1, `
    <h1>Where are you headed?</h1>
    ${obWhy("Your target role decides which skills matter. We compare everything against it.")}
    <div class="stack">
      <fieldset style="border:0;padding:0;margin:0" class="stack-s"><legend class="field" style="margin-bottom:8px">Target role</legend>
        <div class="choice-grid">${ROLE_CHOICES.map((r) => `<button type="button" class="choice" data-action="ob-role" data-role="${esc(r)}" aria-pressed="${d.target_role === r}">${esc(r)}</button>`).join("")}</div>
        <label class="field" style="max-width:420px">Or type your own<input type="text" id="ob-custom-role" value="${isCustom ? esc(d.target_role) : ""}" placeholder="e.g. Analytics Engineer" maxlength="120"></label>
      </fieldset>
      <div class="grid-2">
        <label class="field">Your current role <span class="hint">Optional. Helps frame your transition.</span><input type="text" id="ob-current-role" value="${esc(d.current_role)}" placeholder="e.g. Operations Analyst" maxlength="120"></label>
        <div class="field">Time you can give each week
          <div class="hours"><input type="range" id="ob-hours" min="2" max="40" step="1" value="${d.hours_per_week}" aria-label="Hours per week"><output id="ob-hours-out">${d.hours_per_week} h</output></div>
          <span class="hint">Your roadmap is packed into weeks of this size.</span></div>
      </div>
    </div>`, obFoot(true, "Continue"));
};

Views.obExperience = (d) => {
  const tab = (key, ic, title, sub) => `<button type="button" class="source-tab" data-action="ob-source" data-source="${key}" aria-pressed="${d.source === key}">${icon(ic)}<b>${title}</b><span>${sub}</span></button>`;
  return obShell(2, `
    <h1>What have you done so far?</h1>
    ${obWhy("We pull out only the skills your resume actually backs, each with the exact sentence as proof. Nothing is invented to fill gaps.")}
    <div class="source-tabs">
      ${tab("paste", "paste", "Paste text", "Copy from your resume or LinkedIn")}
      ${tab("upload", "upload", "Upload a text file", ".txt or .md, read in your browser")}
      ${tab("sample", "user", "Use a sample profile", "Fictional ops analyst, for exploring")}
    </div>
    ${d.source === "upload" ? `<label class="btn" style="margin-bottom:12px">${icon("upload")} Choose file<input type="file" id="ob-file" accept=".txt,.md,text/plain,text/markdown" class="sr-only"></label>
      <p class="small muted" style="margin-bottom:12px">PDF and Word files are not supported yet. Export to plain text first.</p>` : ""}
    ${d.sampleLabel && d.source === "sample" ? `<div class="flag" style="margin-bottom:12px">${icon("alert")}<span>${esc(d.sampleLabel)}</span></div>` : ""}
    <label class="field">Resume text <span class="hint" id="ob-resume-count">${words(d.resume_text || "")} words · at least 200 characters</span>
      <textarea id="ob-resume" rows="14" class="mono-input" placeholder="Paste your resume here">${esc(d.resume_text)}</textarea></label>`, obFoot(true, "Continue"));
};

Views.obJd = (jd, i, total) => `
  <div class="jd-card" data-jd="${i}">
    <div class="spread"><span class="eyebrow">Posting ${i + 1}</span>${total > 1 ? `<button class="link-btn small" type="button" data-action="ob-remove-jd" data-index="${i}">Remove</button>` : ""}</div>
    <div class="grid-3">
      <label class="field">Job title <input type="text" name="title" value="${esc(jd.title)}" placeholder="Data Scientist"></label>
      <label class="field">Company <input type="text" name="company" value="${esc(jd.company)}" placeholder="Company name"></label>
      <label class="field">Role type <input type="text" name="role_family" value="${esc(jd.role_family)}" placeholder="Groups postings for tracking"></label>
    </div>
    <label class="field">Posting text <textarea name="text" rows="6" class="mono-input" placeholder="Paste the full job description">${esc(jd.text)}</textarea></label>
  </div>`;

function reliability(count) {
  const msg = count >= RECOMMENDED_POSTINGS
    ? "Good spread. Skills asked for in several postings rank higher."
    : `Works with one. ${RECOMMENDED_POSTINGS - count} more posting${RECOMMENDED_POSTINGS - count === 1 ? "" : "s"} makes demand ranking more reliable.`;
  return `<div class="reliability"><span class="dots" aria-hidden="true">${[0, 1, 2].map((i) => `<i class="${i < count ? "on" : ""}"></i>`).join("")}</span><span>${esc(msg)}</span></div>`;
}

Views.obMarket = (d) => obShell(3, `
  <h1>What do employers ask for?</h1>
  ${obWhy("Paste real postings for roles you want. Every requirement we extract must quote the posting word for word, so demand is never made up.")}
  ${d.sampleLabel && d.source === "sample" ? `<div class="flag" style="margin-bottom:12px">${icon("alert")}<span>Sample postings are fictional companies, written for this demo.</span></div>` : ""}
  <div class="stack-s" id="jd-list">${d.jds.map((jd, i) => Views.obJd(jd, i, d.jds.length)).join("")}</div>
  <div class="spread" style="margin-top:14px">${reliability(d.jds.length)}
    ${d.jds.length < 6 ? `<button class="btn" type="button" data-action="ob-add-jd">+ Add another posting</button>` : ""}</div>`,
obFoot(true, "Build my evidence ledger", "ob-submit"));

Views.obBuilding = (steps) => obShell(4, `
  <div class="build">
    <div class="eyebrow ai"><span class="spinner" aria-hidden="true" style="display:inline-block;vertical-align:-2px;margin-right:6px"></span>Working on it · <span id="elapsed" role="timer">0 s</span></div>
    <h1 style="margin-top:8px">Reading between the lines</h1>
    <p class="muted" style="margin-top:10px">One request to the server, which runs these steps in order with real model calls checked by code. Usually 15–60 seconds. This page updates when the whole request finishes.</p>
    ${processList(steps)}
  </div>`);

/* Steps run server-side inside a single request, so the list explains the work without faking per-step progress. */
function processList(steps) {
  return `<ol class="build-steps process">${steps.map((s) => `<li class="build-step"><span class="dot" aria-hidden="true"></span><span>${esc(s)}</span></li>`).join("")}</ol>`;
}

function chipList(rows, max = 6) {
  const shown = rows.slice(0, max);
  const extra = rows.length - shown.length;
  return `<ul>${shown.map((r) => `<li><button class="chip" type="button" data-action="open-skill" data-skill="${esc(r.skill_id)}">${esc(r.name)}</button></li>`).join("")}${extra > 0 ? `<li class="small muted" style="align-self:center">+${extra} more</li>` : ""}</ul>`;
}

Views.reveal = (s) => {
  const L = s.ledger;
  const proven = L.filter((r) => ["demonstrated", "artifact_backed"].includes(r.level));
  const claimed = L.filter((r) => ["claimed", "partial"].includes(r.level) || r.contested);
  const gaps = L.filter((r) => r.level === "none" && r.demand.jd_count);
  const mustGaps = gaps.filter((r) => r.demand.must_count);
  const { item: first, row: firstRow } = nextPlanStep(s);
  return `<div class="view-enter">
    <section class="hero">
      <div class="eyebrow">Your evidence map is ready</div>
      <h1>${esc(plural(L.length, "skill"))} your target postings ask for</h1>
      <p class="summary">We read ${esc(plural(s.jds.length, "posting"))} and your resume. Every skill below is tied to a quote from a posting, and every resume match to a sentence you wrote.</p>
      ${segBar(L)}
    </section>
    <div class="reveal-grid">
      <div class="card reveal-card"><span class="badge tone-ok">${icon("checkCircle")}Proven</span><div class="big">${proven.length}</div>
        <p class="small muted">${proven.length ? "Backed by a passed assessment or a reviewed project excerpt." : "Nothing is proven yet. Resumes make claims; checks turn them into proof."}</p>${chipList(proven)}</div>
      <div class="card reveal-card"><span class="badge tone-warn">${icon("dashed")}Claimed, needs proof</span><div class="big">${claimed.length}</div>
        <p class="small muted">Your resume backs these with a verified sentence. A short assessment can confirm them.</p>${chipList(claimed)}</div>
      <div class="card reveal-card"><span class="badge tone-gap">${icon("alert")}Gaps</span><div class="big">${gaps.length}</div>
        <p class="small muted">${mustGaps.length ? `${plural(mustGaps.length, "is a must-have", "are must-haves")} in at least one posting.` : "Asked for, with no evidence yet."}</p>${chipList(gaps)}</div>
      <div class="card reveal-card"><span class="badge tone-ai">${icon("sparkle")}Top opportunities</span>
        <ol class="stack-s small" style="margin:14px 0 0;padding-left:18px">${L.slice(0, 3).map((r) => `<li><button class="skill-btn" type="button" data-action="open-skill" data-skill="${esc(r.skill_id)}">${esc(r.name)}</button><div class="muted">${esc(demandText(r.demand))}</div></li>`).join("")}</ol></div>
    </div>
    ${first ? `<section class="card next-action raised" style="margin-top:20px">
      <div class="eyebrow ai">Recommended first move</div>
      <h2>${esc(firstLine(firstRow || { level: first.why.level, name: first.skill }))}</h2>
      <p class="why">${esc(first.detail)}</p>
      <div class="row" style="margin-top:16px">
        ${canAssessRow(firstRow)
    ? `<button class="btn primary lg" type="button" data-action="assess-skill" data-skill="${esc(first.skill_id)}">Prove ${esc(first.skill)} now ${icon("arrow")}</button>`
    : `<button class="btn primary lg" type="button" data-action="agent-next">Let my AI coach pick a first check ${icon("arrow")}</button>`}
        <a class="btn lg" href="#/home">Go to my dashboard</a></div>
    </section>` : ""}
    ${s.rejected_count ? `<p class="foot-note">${icon("shield")}${esc(plural(s.rejected_count, "extracted item"))} failed quote verification and ${s.rejected_count === 1 ? "was" : "were"} discarded. <button class="link-btn" data-action="show-rejected">See which</button></p>` : ""}
  </div>`;
};

/* Headline for the single most useful action, written from the evidence state. */
function firstLine(row) {
  const name = row.name;
  if (row.contested) return `Your ${name} result conflicts with your resume. Let's settle it.`;
  return {
    none: `No evidence for ${name} yet, and employers ask for it.`,
    claimed: `Your ${name} experience is claimed, but not yet demonstrated.`,
    partial: `You're partway there on ${name}. Close the missed criteria.`,
    demonstrated: `${name} is demonstrated. Back it with reviewable work.`,
    artifact_backed: `${name} is backed by a reviewed project excerpt.`,
  }[row.level] || name;
}

function segBar(ledger) {
  const groups = [
    { key: "strong", label: "Artifact-backed", n: ledger.filter((r) => r.level === "artifact_backed").length },
    { key: "ok", label: "Demonstrated", n: ledger.filter((r) => r.level === "demonstrated" && !r.contested).length },
    { key: "warn", label: "Claimed or partial", n: ledger.filter((r) => ["claimed", "partial"].includes(r.level) && !r.contested).length },
    { key: "gap", label: "No evidence or contested", n: ledger.filter((r) => r.level === "none" || r.contested).length },
  ];
  const total = ledger.length || 1;
  return `<div class="segbar" role="img" aria-label="${esc(groups.map((g) => `${g.n} ${g.label}`).join(", "))}">${groups.filter((g) => g.n).map((g) => `<span class="seg-${g.key}" style="flex:${g.n / total}"></span>`).join("")}</div>
    <div class="seg-legend">${groups.map((g) => `<span><i class="seg-${g.key}"></i><b>${g.n}</b> ${esc(g.label)}</span>`).join("")}</div>`;
}
