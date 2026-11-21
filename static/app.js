/* Router, data loading and interaction wiring. */
"use strict";

const App = {
  state: null,
  ledgerFilter: "all",
  currentAssessment: null,
  lastResult: null,
  jds: [],
  sampleLabel: "",
  lastFocus: null,
};

const view = () => document.getElementById("view");

function route() {
  return (location.hash.replace(/^#\//, "") || "overview").split("?")[0];
}

function setNav(active) {
  document.querySelectorAll("#nav a").forEach((a) => {
    if (a.dataset.view === active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  document.getElementById("nav-proposal").hidden = !(App.state && App.state.proposal);
}

function renderEngine(llmStatus) {
  const pill = document.getElementById("engine-pill");
  if (!llmStatus.configured) {
    pill.className = "pill bad";
    pill.textContent = "AI not configured";
    pill.title = "Set ANTHROPIC_API_KEY in .env and restart the server.";
  } else if (!llmStatus.is_ai) {
    pill.className = "pill warn";
    pill.textContent = llmStatus.label;
    pill.title = "Offline heuristic mode: not an AI model.";
  } else {
    pill.className = "pill ok";
    pill.textContent = llmStatus.label;
    pill.title = "";
  }
}

async function loadState() {
  App.state = await api("/api/state");
  renderEngine(App.state.llm);
  return App.state;
}

async function render() {
  const name = route();
  try {
    await loadState();
  } catch (err) {
    showError(err);
    return;
  }
  if (!App.state.profile) {
    setNav(null);
    renderIntake();
    return;
  }
  setNav(name);
  const loaders = {
    overview: async () => Views.overview(App.state),
    ledger: async () => Views.ledger(App.state, App.ledgerFilter),
    plan: async () => Views.plan(await api("/api/plan")),
    assess: async () => {
      const list = await api("/api/assessments");
      const open = list.find((a) => a.status === "open");
      if (!App.lastResult) App.currentAssessment = open || null;
      return Views.assess(list, App.currentAssessment, App.lastResult);
    },
    projects: async () => Views.projects(await api("/api/projects")),
    applications: async () => {
      const families = [...new Set(App.state.jds.map((j) => j.role_family))];
      return Views.applications(await api("/api/applications"), families);
    },
    activity: async () => Views.activity(await api("/api/activity")),
  };
  try {
    view().innerHTML = await (loaders[name] || loaders.overview)();
    if (name === "assess") bindAnswerCounter();
  } catch (err) {
    showError(err);
  }
}

/* ---- intake ---- */

function renderIntake() {
  view().innerHTML = Views.intake(App.sampleLabel);
  if (!App.jds.length) App.jds = [{}, {}];
  renderJds();
}

function renderJds() {
  document.getElementById("jd-list").innerHTML = App.jds.map((jd, i) => Views.jdCard(i, jd)).join("");
}

function collectJds() {
  return [...document.querySelectorAll(".jd-card")].map((card) => ({
    title: card.querySelector("[name=title]").value.trim(),
    company: card.querySelector("[name=company]").value.trim(),
    role_family: card.querySelector("[name=role_family]").value.trim(),
    text: card.querySelector("[name=text]").value.trim(),
  }));
}

async function loadSample() {
  const sample = await api("/api/demo-data");
  const form = document.getElementById("intake-form");
  form.resume_text.value = sample.resume_text;
  form.target_role.value = sample.target_role;
  form.hours_per_week.value = sample.hours_per_week;
  App.jds = sample.jds;
  App.sampleLabel = sample.label;
  renderJds();
  const note = document.getElementById("sample-note");
  note.textContent = sample.label;
  note.hidden = false;
  toast("Sample data loaded. It is fictional and labelled as such.");
}

async function submitIntake(form) {
  const body = {
    resume_text: form.resume_text.value.trim(),
    target_role: form.target_role.value.trim(),
    hours_per_week: Number(form.hours_per_week.value),
    jds: collectJds(),
  };
  const steps = [
    `Extracting requirements from ${body.jds.length} postings`,
    "Verifying every quote against the source text",
    "Merging equivalent skills",
    "Matching resume evidence",
    "Computing priorities and plan v1",
  ];
  const progress = document.getElementById("intake-progress");
  const submit = document.getElementById("intake-submit");
  let step = 0;
  progress.hidden = false;
  progress.innerHTML = Views.progress(steps, 0);
  const timer = setInterval(() => {
    step = Math.min(step + 1, steps.length - 1);
    progress.innerHTML = Views.progress(steps, step);
  }, 6000);
  const result = await withBusy(submit, "Building ledger…", () => api("/api/intake", { method: "POST", body }));
  clearInterval(timer);
  progress.hidden = true;
  if (result) {
    App.jds = [];
    toast(`${result.skills} skills, ${result.claims} verified resume claims, ${result.rejected} unverifiable items rejected.`);
    location.hash = "#/overview";
    render();
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
  document.getElementById("drawer").hidden = true;
  document.getElementById("drawer-backdrop").hidden = true;
  if (App.lastFocus && App.lastFocus.isConnected) App.lastFocus.focus();
}

async function openSkill(skillId) {
  try {
    openDrawer(Views.skillDrawer(await api(`/api/skills/${encodeURIComponent(skillId)}`)));
  } catch (err) {
    showError(err);
  }
}

/* ---- assessments ---- */

function bindAnswerCounter() {
  const form = document.getElementById("answer-form");
  if (!form) return;
  const counter = document.getElementById("word-count");
  form.answer.addEventListener("input", () => {
    counter.textContent = `${words(form.answer.value)} words · aim for 150–300`;
  });
}

async function startAssessment(button, skillId) {
  const created = await withBusy(button, skillId ? "Writing question…" : "Agent is choosing…", () =>
    skillId ? api("/api/assessments", { method: "POST", body: { skill_id: skillId } }) : api("/api/assessments/next", { method: "POST" }),
  );
  if (!created) return;
  App.currentAssessment = created;
  App.lastResult = null;
  closeDrawer();
  if (route() === "assess") render();
  else location.hash = "#/assess";
}

async function submitAnswer(form) {
  const button = document.getElementById("answer-submit");
  const stages = ["Verifying quoted evidence…", "Agent is reviewing the ledger…", "Checking for a plan change…"];
  let stage = 0;
  const timer = setInterval(() => {
    if (button.isConnected && stage < stages.length) button.lastChild.textContent = stages[stage++];
  }, 7000);
  const result = await withBusy(button, "Grading against rubric…", () =>
    api(`/api/assessments/${form.dataset.id}/answer`, { method: "POST", body: { answer: form.answer.value } }),
  );
  clearInterval(timer);
  if (!result) return;
  App.lastResult = result;
  App.currentAssessment = null;
  render();
}

/* ---- event delegation ---- */

const actions = {
  "load-sample": (el) => withBusy(el, "Loading…", loadSample),
  "add-jd": () => {
    App.jds = collectJds();
    if (App.jds.length >= 6) return toast("Up to 6 postings.");
    App.jds.push({});
    renderJds();
  },
  "remove-jd": (el) => {
    App.jds = collectJds();
    if (App.jds.length <= 2) return toast("At least 2 postings are needed for demand frequency.");
    App.jds.splice(Number(el.dataset.index), 1);
    renderJds();
  },
  "open-skill": (el) => openSkill(el.dataset.skill),
  "close-drawer": () => closeDrawer(),
  "assess-skill": (el) => startAssessment(el, el.dataset.skill),
  "agent-next": (el) => startAssessment(el, null),
  filter: (el) => {
    App.ledgerFilter = el.dataset.filter;
    view().innerHTML = Views.ledger(App.state, App.ledgerFilter);
  },
  "accept-proposal": async (el) => {
    const r = await withBusy(el, "Applying…", () => api(`/api/plan/proposals/${el.dataset.id}/accept`, { method: "POST" }));
    if (r) { toast(`Plan v${r.version} is now active.`); render(); }
  },
  "reject-proposal": async (el) => {
    const r = await withBusy(el, "Rejecting…", () => api(`/api/plan/proposals/${el.dataset.id}/reject`, { method: "POST" }));
    if (r) { toast("Proposal rejected. Active plan unchanged."); render(); }
  },
  "generate-projects": async (el) => {
    const r = await withBusy(el, "Mapping projects to gaps…", () => api("/api/projects/generate", { method: "POST" }));
    if (r) render();
  },
  "review-artifact": async (el) => {
    const r = await withBusy(el, "Reviewing…", () => api(`/api/artifacts/${el.dataset.id}/review`, { method: "POST" }));
    if (!r) return;
    toast(`Artifact ${r.review_status}.${r.proposal ? " The agent proposed a plan change." : ""}`);
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

document.addEventListener("change", async (event) => {
  const el = event.target;
  if (el.dataset.action !== "app-status") return;
  const r = await withBusy(null, "", () => api(`/api/applications/${el.dataset.id}`, { method: "PATCH", body: { status: el.value } }));
  if (r) { toast(r.proposal ? "Response pattern found; the agent proposed a plan change." : r.insights.message); render(); }
});

document.addEventListener("submit", async (event) => {
  const form = event.target;
  event.preventDefault();
  if (form.id === "intake-form") return submitIntake(form);
  if (form.id === "answer-form") return submitAnswer(form);
  if (form.id === "app-form") {
    const body = Object.fromEntries(new FormData(form));
    const r = await withBusy(form.querySelector("button[type=submit]"), "Logging…", () => api("/api/applications", { method: "POST", body }));
    if (r) { toast(r.proposal ? "Response pattern found; the agent proposed a plan change." : r.insights.message); render(); }
    return;
  }
  if (form.classList.contains("artifact-form")) {
    const body = Object.fromEntries(new FormData(form));
    const r = await withBusy(form.querySelector("button[type=submit]"), "Linking…", () =>
      api(`/api/projects/${form.dataset.project}/artifacts`, { method: "POST", body }),
    );
    if (r) { toast("Linked. It counts once it passes review."); render(); }
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !document.getElementById("drawer").hidden) closeDrawer();
});
document.getElementById("drawer-backdrop").addEventListener("click", closeDrawer);
document.getElementById("reset-btn").addEventListener("click", async () => {
  if (!confirm("Start a new intake? This deletes the current workspace, its evidence and plan history.")) return;
  const r = await withBusy(null, "", () => api("/api/reset", { method: "POST" }));
  if (r) { App.lastResult = null; App.currentAssessment = null; location.hash = "#/overview"; render(); }
});
window.addEventListener("hashchange", () => {
  if (route() !== "assess") App.lastResult = null;
  clearBanner();
  render();
});

render();
