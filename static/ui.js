/* Shared UI helpers. Every dynamic string goes through esc() before reaching innerHTML. */
"use strict";

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function api(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: { "X-ProofPath-Client": "web", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError(0, "NETWORK", "Could not reach the ProofPath server.");
  }
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    if (data && data.error) throw new ApiError(response.status, data.error.code, data.error.message);
    if (data && Array.isArray(data.detail)) {
      const first = data.detail[0];
      const where = (first.loc || []).slice(1).join(" → ");
      throw new ApiError(response.status, "VALIDATION", `${where ? where + ": " : ""}${first.msg}`);
    }
    throw new ApiError(response.status, "HTTP_" + response.status, "Request failed.");
  }
  return data;
}

/* Per-viewer conveniences only (view mode, unsent onboarding draft). Never required to render. */
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(`proofpath:${key}`);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (err) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`proofpath:${key}`, JSON.stringify(value));
    } catch (err) {
      /* storage blocked: the page still works, the convenience is lost */
    }
  },
  remove(key) {
    try { localStorage.removeItem(`proofpath:${key}`); } catch (err) { /* see set() */ }
  },
};

function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 3600);
}

const ERROR_TITLES = {
  LLM_UNAVAILABLE: "AI engine not configured",
  LLM_FAILED: "The AI step failed. Nothing was faked.",
  NETWORK: "Server unreachable",
  VALIDATION: "Check your input",
  INVALID_INPUT: "Check your input",
  ALREADY_ANSWERED: "Already answered",
  STALE_PROPOSAL: "Proposal is out of date",
  NOT_FOUND: "Not found",
  FORBIDDEN: "Request blocked. Reload the page.",
};

function showError(err) {
  const banner = document.getElementById("banner");
  banner.innerHTML = `<strong>${esc(ERROR_TITLES[err.code] || "Something went wrong")}</strong>${esc(err.message)}`;
  banner.hidden = false;
  banner.scrollIntoView({ block: "nearest" });
}

function clearBanner() {
  const banner = document.getElementById("banner");
  banner.hidden = true;
  banner.innerHTML = "";
}

async function withBusy(button, label, fn) {
  const original = button ? button.innerHTML : "";
  if (button) {
    button.disabled = true;
    button.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${esc(label)}</span>`;
  }
  clearBanner();
  try {
    return await fn();
  } catch (err) {
    showError(err instanceof ApiError ? err : new ApiError(0, "CLIENT", err.message));
    return undefined;
  } finally {
    if (button && button.isConnected) {
      button.disabled = false;
      button.innerHTML = original;
    }
  }
}

/* ---- icons (inline SVG, stroke = currentColor) ---- */

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  route: '<circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h8.5a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7H16"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
  pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  dashed: '<circle cx="12" cy="12" r="9" stroke-dasharray="3.5 3"/>',
  half: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  upload: '<path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  paste: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  trend: '<path d="m3 17 6-6 4 4 8-8M15 7h6v6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  code: '<path d="m8 8-5 4 5 4M16 8l5 4-5 4M14 4l-4 16"/>',
};

function icon(name, label = "") {
  const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
  return `<svg class="icon" viewBox="0 0 24 24" ${a11y}>${ICONS[name] || ""}</svg>`;
}

/* ---- evidence language: icon + label + colour, never colour alone ---- */

const LEVELS = {
  none: { label: "No evidence", tone: "gap", icon: "alert", meter: "gap" },
  claimed: { label: "Claimed", tone: "warn", icon: "dashed", meter: "warn" },
  partial: { label: "Partial", tone: "warn", icon: "half", meter: "warn" },
  demonstrated: { label: "Demonstrated", tone: "ok", icon: "checkCircle", meter: "" },
  artifact_backed: { label: "Artifact-backed", tone: "strong", icon: "shield", meter: "" },
};
const LEVEL_LABEL = Object.fromEntries(Object.entries(LEVELS).map(([k, v]) => [k, v.label]));

const UNCERTAINTY_LABEL = {
  unknown: "Unknown",
  high: "Self-reported",
  medium: "Single check",
  low: "Consistent",
  conflicting: "Conflicting",
};

function levelBadge(row) {
  const lvl = LEVELS[row.level] || LEVELS.none;
  const tone = row.contested ? "gap" : lvl.tone;
  const label = `${lvl.label}${row.contested ? ", contested" : ""}`;
  return `<span class="badge tone-${tone}">${icon(row.contested ? "alert" : lvl.icon)}${esc(label)}</span>`;
}

function meter(value, tone = "") {
  const pct = Math.max(2, Math.min(100, Math.round(Number(value) * 100)));
  return `<div class="meter ${tone}" role="presentation"><span style="width:${pct}%"></span></div>`;
}

function strengthMeter(row) {
  const tone = row.contested ? "gap" : (LEVELS[row.level] || LEVELS.none).meter;
  return meter(row.strength, tone);
}

/* What the evidence state asks the user to do next. Mirrors planner.ACTION_BY_STATE in plain words. */
function nextStepFor(row) {
  if (row.contested) return "Rework the missed criteria, then re-assess";
  return {
    none: "Learn the basics, then prove it",
    claimed: "Take an assessment to prove the claim",
    partial: "Practise the weak criteria, then re-assess",
    demonstrated: "Ship an artifact to back it with work",
    artifact_backed: "Backed by a reviewed project excerpt",
  }[row.level];
}

function demandText(d) {
  if (!d.jd_count) return "Not in your postings";
  const must = d.must_count ? ` · ${d.must_count} must-have` : "";
  return `Asked in ${d.jd_count} of ${d.jd_total} posting${d.jd_total === 1 ? "" : "s"}${must}`;
}

const ACTION_META = {
  learn: { label: "Learn", icon: "book", done: "Basics covered and a first proof of work" },
  prove: { label: "Prove", icon: "target", done: "An assessment passes on this skill" },
  remediate: { label: "Remediate", icon: "refresh", done: "The missed criteria are met on re-assessment" },
  strengthen: { label: "Strengthen", icon: "trend", done: "A re-assessment reaches a pass" },
  artifact: { label: "Ship artifact", icon: "file", done: "A pasted excerpt of your project passes review" },
};

function tag(text, tone = "neutral") {
  return `<span class="badge tone-${esc(tone)}">${esc(text)}</span>`;
}

const OUTCOME_TONE = { pass: "ok", partial: "warn", fail: "gap" };
const OUTCOME_LABEL = { pass: "Pass", partial: "Partial", fail: "Not yet" };

function outcomeTag(outcome) {
  return tag(OUTCOME_LABEL[outcome] || outcome, OUTCOME_TONE[outcome] || "neutral");
}

function fmtTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function strength(value) {
  return Number(value).toFixed(2);
}

function words(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function humanize(value) {
  return String(value ?? "").replace(/_/g, " ");
}

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/* Agent summaries arrive as light markdown. Show them as plain text, optionally clipped at a word. */
function plainText(text, max = 0) {
  const flat = String(text ?? "").replace(/\*\*|__|`/g, "").replace(/^\s*[-#>]+\s*/gm, "").replace(/\s+/g, " ").trim();
  if (!max || flat.length <= max) return flat;
  return `${flat.slice(0, flat.lastIndexOf(" ", max))}…`;
}

/* ---- one source of truth for "what next" ----
   The approved plan can lag the ledger (a declined or still-pending update). A plan step is
   covered when the skill's persisted evidence already goes beyond what the step asks for. */
function isStepCovered(item, row) {
  if (!row) return false;
  if (row.level === "artifact_backed") return true;
  return ["prove", "strengthen", "remediate", "learn"].includes(item.action) && row.level === "demonstrated" && !row.contested;
}

function nextPlanStep(state) {
  const items = (state.plan?.plan?.weeks || []).flatMap((w) => w.items.map((i) => ({ ...i, week: w.week })));
  const rowOf = (i) => state.ledger.find((r) => r.skill_id === i.skill_id);
  const item = items.find((i) => !isStepCovered(i, rowOf(i))) || null;
  const covered = items.filter((i) => isStepCovered(i, rowOf(i))).length;
  return { item, row: item ? rowOf(item) : null, covered };
}

/* Assessments can move a claim; projects are the route for gaps and for demonstrated skills. */
function canAssessRow(row) {
  return Boolean(row) && (["claimed", "partial"].includes(row.level) || row.contested);
}

/* Real elapsed time for a long request. Returns the interval id; clear it when the request settles. */
function startElapsed() {
  const started = Date.now();
  return setInterval(() => {
    const el = document.getElementById("elapsed");
    if (el) el.textContent = `${Math.round((Date.now() - started) / 1000)} s`;
  }, 1000);
}
