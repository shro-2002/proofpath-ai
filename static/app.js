/* Router, data loading and interaction wiring. */
"use strict";

const App = {
  state: null,
  skillFilter: "all",
  skillMode: store.get("skillMode", "cards"),
  activityDev: store.get("activityDev", false),
  currentAssessment: null,
  lastResult: null,
  lastShift: null,
  pendingAnswer: "",
  lastFocus: null,
};

const view = () => document.getElementById("view");
const ALIASES = { overview: "home", ledger: "skills", assess: "practice", plan: "roadmap", applications: "opportunities" };
const NAV = [
  { route: "home", label: "Home", icon: "home" },
  { route: "skills", label: "My skills", short: "Skills", icon: "layers" },
  { route: "practice", label: "Practice", icon: "target", sub: [["practice", "Assessments"], ["projects", "Projects"]] },
  { route: "roadmap", label: "Roadmap", icon: "route", dot: true },
  { route: "opportunities", label: "Opportunities", short: "Jobs", icon: "briefcase" },
];

function route() {
  const name = (location.hash.replace(/^#\//, "") || "home").split("?")[0];
  return ALIASES[name] || name;
}

/* Full label on desktop, a short one in the phone tab bar. Only one is ever displayed. */
function navLabel(full, short) {
  return short ? `<span class="nav-full">${full}</span><span class="nav-short">${short}</span>` : `<span>${full}</span>`;
}

function renderNav(active) {
  const current = (r) => (r === active ? 'aria-current="page"' : "");
  const inPractice = active === "practice" || active === "projects";
  document.getElementById("nav").innerHTML = NAV.map((n) => {
    const isActive = n.route === active || (n.sub && inPractice);
    const dot = n.dot && App.state?.proposal ? '<span class="nav-dot" role="img" aria-label="Update waiting for approval"></span>' : "";
    const link = `<a href="#/${n.route}" ${isActive ? 'aria-current="page"' : ""}>${icon(n.icon)}${navLabel(n.label, n.short)}${dot}</a>`;
    const sub = n.sub && inPractice ? `<div class="nav-sub">${n.sub.map(([r, l]) => `<a href="#/${r}" ${current(r)}>${l}</a>`).join("")}</div>` : "";
    return link + sub;
  }).join("") + `<a class="nav-secondary" href="#/activity" ${current("activity")}>${icon("pulse")}${navLabel("AI coach log", "Coach")}</a>`;
}

function renderEngine(llmStatus) {
  const pill = document.getElementById("engine-pill");
  const [tone, full, short, title] = !llmStatus.configured
    ? ["bad", "AI not configured", "AI off", "Set ANTHROPIC_API_KEY in .env and restart the server."]
    : !llmStatus.is_ai
      ? ["warn", llmStatus.label, "Offline", "Offline heuristic mode: not an AI model."]
      : ["ok", llmStatus.label, "Claude", llmStatus.label];
  pill.className = `pill ${tone}`;
  pill.title = title;
  pill.innerHTML = navLabel(esc(full), esc(short));
}

async function loadState() {
  App.state = await api("/api/state");
  renderEngine(App.state.llm);
  return App.state;
}

const loaders = {
  home: async () => {
    const [activity, assessments, plan] = await Promise.all([api("/api/activity"), api("/api/assessments"), api("/api/plan")]);
    return Views.home(App.state, activity, assessments, plan.versions);
  },
  reveal: async () => Views.reveal(App.state),
  skills: async () => Views.skills(App.state, App.skillFilter, App.skillMode),
  roadmap: async () => Views.roadmap(await api("/api/plan"), App.state),
  practice: async () => {
    const list = await api("/api/assessments");
    if (!App.lastResult) App.currentAssessment = list.find((a) => a.status === "open") || null;
    return Views.practice(list, App.currentAssessment, App.lastResult, App.lastShift, App.state);
  },
  projects: async () => Views.projects(await api("/api/projects"), App.state),
  opportunities: async () => {
    const families = [...new Set(App.state.jds.map((j) => j.role_family))];
    return Views.opportunities(await api("/api/applications"), families);
  },
  activity: async () => {
    const [entries, plan] = await Promise.all([api("/api/activity"), api("/api/plan")]);
    return Views.activity(entries, App.activityDev, plan.versions);
  },
};

async function render() {
  const name = route();
  try {
    await loadState();
  } catch (err) {
    showError(err);
    return;
  }
  const shell = document.getElementById("shell");
  if (!App.state.profile) {
    shell.classList.add("onboarding");
    Onboarding.render();
    return;
  }
  shell.classList.remove("onboarding");
  renderNav(name === "reveal" ? "home" : name);
  try {
    const loader = Object.hasOwn(loaders, name) ? loaders[name] : loaders.home;
    view().innerHTML = await loader();
    if (name === "practice") bindAnswerEditor();
  } catch (err) {
    showError(err);
  }
}

/* ---- drawer ---- */

function openDrawer(html) {
  App.lastFocus = document.activeElement;
  document.getElementById("drawer-body").innerHTML = html;
  document.getElementById("drawer").hidden = false;
  document.getElementById("drawer-backdrop").hidden = false;
  const close = document.querySelector("#drawer [data-action=close-drawer]");
  if (close) close.focus();
}

function closeDrawer() {
  if (document.getElementById("drawer").hidden) return;
  document.getElementById("drawer").hidden = true;
  document.getElementById("drawer-backdrop").hidden = true;
  if (App.lastFocus && App.lastFocus.isConnected) App.lastFocus.focus();
}

function trapFocus(event) {
  const focusable = [...document.querySelectorAll("#drawer a[href], #drawer button:not([disabled]), #drawer input, #drawer select, #drawer textarea")];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

async function openSkill(skillId) {
  try {
    openDrawer(Views.skillDrawer(await api(`/api/skills/${encodeURIComponent(skillId)}`)));
  } catch (err) {
    showError(err);
  }
}

/* ---- assessments ---- */

function bindAnswerEditor() {
  const form = document.getElementById("answer-form");
  if (!form) return;
  if (App.pendingAnswer) form.answer.value = App.pendingAnswer;
  const update = () => {
    const n = words(form.answer.value);
    document.getElementById("word-count").textContent = `${n} words`;
    document.querySelector("#wc-meter span").style.width = `${Math.max(2, Math.min(100, (n / TARGET_WORDS) * 100))}%`;
  };
  form.answer.addEventListener("input", update);
  update();
}

async function startAssessment(button, skillId) {
  const created = await withBusy(button, skillId ? "Writing your question…" : "Coach is choosing…", () =>
    skillId ? api("/api/assessments", { method: "POST", body: { skill_id: skillId } }) : api("/api/assessments/next", { method: "POST" }),
  );
  if (!created) return;
  App.currentAssessment = created;
  App.lastResult = null;
  App.pendingAnswer = "";
  closeDrawer();
  if (route() === "practice") render();
  else location.hash = "#/practice";
}

async function submitAnswer(form) {
  const answer = form.answer.value;
  if (!answer.trim()) return showError(new ApiError(0, "VALIDATION", "Write an answer before submitting."));
  const skillId = App.currentAssessment?.skill_id;
  const before = App.state.ledger.find((r) => r.skill_id === skillId) || null;
  const main = document.getElementById("practice-main");
  const skill = App.currentAssessment?.skill_name || "";
  App.pendingAnswer = answer;
  main.innerHTML = Views.grading(skill);
  const timer = startElapsed();
  const result = await withBusy(null, "", () => api(`/api/assessments/${form.dataset.id}/answer`, { method: "POST", body: { answer } }));
  clearInterval(timer);
  if (!result) return render();
  await loadState();
  App.lastShift = { before, after: App.state.ledger.find((r) => r.skill_id === skillId) || null };
  App.lastResult = result;
  App.currentAssessment = null;
  App.pendingAnswer = "";
  render();
}

async function decideProposal(el, accept) {
  const verb = accept ? "accept" : "reject";
  const r = await withBusy(el, accept ? "Applying…" : "Keeping plan…", () => api(`/api/plan/proposals/${el.dataset.id}/${verb}`, { method: "POST" }));
  if (!r) return;
  toast(accept ? `Roadmap v${r.version} is now active.` : "Update declined. Your roadmap is unchanged.");
  if (App.lastResult) App.lastResult = { ...App.lastResult, proposal: null, decision: accept ? `You accepted roadmap v${r.version}.` : "You kept your current roadmap." };
  render();
}

async function afterApplication(promise, button, label) {
  const r = await withBusy(button, label, () => promise());
  if (r) { toast(r.proposal ? "A response pattern emerged. Your coach recommends a roadmap update." : r.insights.message); render(); }
}

/* ---- event delegation ---- */

const actions = {
  ...onboardingActions,
  "open-skill": (el) => openSkill(el.dataset.skill),
  "close-drawer": () => closeDrawer(),
  "assess-skill": (el) => startAssessment(el, el.dataset.skill),
  "agent-next": (el) => startAssessment(el, null),
  filter: (el) => {
    App.skillFilter = el.dataset.filter;
    view().innerHTML = Views.skills(App.state, App.skillFilter, App.skillMode);
  },
  "skills-mode": (el) => {
    App.skillMode = el.dataset.mode;
    store.set("skillMode", App.skillMode);
    view().innerHTML = Views.skills(App.state, App.skillFilter, App.skillMode);
  },
  "activity-mode": (el) => {
    App.activityDev = el.dataset.dev === "1";
    store.set("activityDev", App.activityDev);
    render();
  },
  "accept-proposal": (el) => decideProposal(el, true),
  "reject-proposal": (el) => decideProposal(el, false),
  "generate-projects": async (el) => {
    const r = await withBusy(el, "Designing projects for your gaps…", () => api("/api/projects/generate", { method: "POST" }));
    if (r) render();
  },
  "review-artifact": async (el) => {
    const r = await withBusy(el, "Reviewing excerpt…", () => api(`/api/artifacts/${el.dataset.id}/review`, { method: "POST" }));
    if (!r) return;
    toast(r.review_status === "passed" ? `Excerpt passed review.${r.proposal ? " Your coach recommends a roadmap update." : ""}` : "Needs improvement. See which criteria were missed.");
    render();
  },
  "show-rejected": async () => {
    try {
      openDrawer(Views.rejected(await api("/api/rejected")));
    } catch (err) {
      showError(err);
    }
  },
};

document.addEventListener("click", (event) => {
  const el = event.target.closest("[data-action]");
  if (!el || el.tagName === "SELECT") return;
  const fn = actions[el.dataset.action];
  if (fn) {
    event.preventDefault();
    event.stopPropagation();
    fn(el);
  }
});

document.addEventListener("change", (event) => {
  const el = event.target;
  if (el.dataset.action !== "app-status") return;
  afterApplication(() => api(`/api/applications/${el.dataset.id}`, { method: "PATCH", body: { status: el.value } }), null, "");
});

document.addEventListener("submit", async (event) => {
  const form = event.target;
  event.preventDefault();
  if (form.id === "answer-form") return submitAnswer(form);
  if (form.id === "app-form") {
    const body = Object.fromEntries(new FormData(form));
    return afterApplication(() => api("/api/applications", { method: "POST", body }), form.querySelector("button[type=submit]"), "Logging…");
  }
  if (form.classList.contains("artifact-form")) {
    const body = Object.fromEntries(new FormData(form));
    const r = await withBusy(form.querySelector("button[type=submit]"), "Submitting…", () => api(`/api/projects/${form.dataset.project}/artifacts`, { method: "POST", body }));
    if (r) { toast("Submitted. It counts as evidence once the excerpt passes review."); render(); }
  }
});

document.addEventListener("keydown", (event) => {
  if (document.getElementById("drawer").hidden) return;
  if (event.key === "Escape") closeDrawer();
  if (event.key === "Tab") trapFocus(event);
});
document.getElementById("drawer-backdrop").addEventListener("click", closeDrawer);
document.getElementById("reset-btn").addEventListener("click", async () => {
  if (!confirm("Start a new profile? This deletes the current workspace, its evidence and roadmap history.")) return;
  const r = await withBusy(null, "", () => api("/api/reset", { method: "POST" }));
  if (!r) return;
  App.lastResult = null;
  App.currentAssessment = null;
  Onboarding.reset();
  location.hash = "#/home";
  render();
});
window.addEventListener("hashchange", () => {
  window.scrollTo(0, 0);
  if (route() !== "practice") { App.lastResult = null; App.lastShift = null; }
  clearBanner();
  closeDrawer();
  render();
});

Onboarding.load();
render();
