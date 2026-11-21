/* Onboarding controller: a small draft object, one step at a time, persisted locally until submitted. */
"use strict";

const MIN_TEXT = 200;
const MAX_UPLOAD_BYTES = 200 * 1024;
const BUILD_STEPS = [
  "Extracting requirements from your postings",
  "Verifying every quote against the source text",
  "Merging equivalent skills",
  "Matching resume evidence",
  "Ranking gaps and drafting your roadmap",
];

const freshDraft = () => ({ step: 0, target_role: "", current_role: "", hours_per_week: 8, source: "paste", resume_text: "", jds: [{}], sampleLabel: "" });

const Onboarding = {
  draft: freshDraft(),

  load() {
    this.draft = { ...freshDraft(), ...store.get("draft", {}) };
    if (this.draft.step > 3) this.draft = { ...this.draft, step: 3 };
  },

  update(patch) {
    this.draft = { ...this.draft, ...patch };
    store.set("draft", this.draft);
  },

  reset() {
    store.remove("draft");
    this.draft = freshDraft();
  },

  render() {
    const d = this.draft;
    const screens = [Views.obWelcome, Views.obGoal, Views.obExperience, Views.obMarket];
    view().innerHTML = (screens[d.step] || Views.obWelcome)(d);
    const focusTarget = view().querySelector("h1");
    if (focusTarget && d.step > 0) { focusTarget.tabIndex = -1; focusTarget.focus({ preventScroll: true }); }
    window.scrollTo({ top: 0 });
  },

  /* Read the visible step's fields into the draft before moving away from it. */
  collect() {
    const d = this.draft;
    if (d.step === 1) {
      const custom = document.getElementById("ob-custom-role").value.trim();
      this.update({
        target_role: custom || d.target_role,
        current_role: document.getElementById("ob-current-role").value.trim(),
        hours_per_week: Number(document.getElementById("ob-hours").value),
      });
    } else if (d.step === 2) {
      this.update({ resume_text: document.getElementById("ob-resume").value });
    } else if (d.step === 3) {
      this.update({ jds: collectJdCards() });
    }
  },

  validate() {
    const d = this.draft;
    if (d.step === 1 && d.target_role.trim().length < 2) return "Pick or type the role you're aiming for.";
    if (d.step === 2 && d.resume_text.trim().length < MIN_TEXT) return `Your resume text needs at least ${MIN_TEXT} characters so there is something to quote.`;
    if (d.step === 3) {
      const bad = d.jds.findIndex((j) => !j.title || !j.company || (j.text || "").length < MIN_TEXT);
      if (bad >= 0) return `Posting ${bad + 1} needs a job title, a company and at least ${MIN_TEXT} characters of posting text.`;
    }
    return null;
  },

  next() {
    this.collect();
    const problem = this.validate();
    if (problem) return showError(new ApiError(0, "VALIDATION", problem));
    clearBanner();
    this.update({ step: this.draft.step + 1 });
    this.render();
  },

  back() {
    this.collect();
    clearBanner();
    this.update({ step: Math.max(0, this.draft.step - 1) });
    this.render();
  },

  async loadSample(button) {
    const sample = await withBusy(button, "Loading sample…", () => api("/api/demo-data"));
    if (!sample) return;
    this.update({
      step: 1, source: "sample", target_role: sample.target_role, current_role: sample.current_role || "",
      hours_per_week: sample.hours_per_week, resume_text: sample.resume_text, jds: sample.jds, sampleLabel: sample.label,
    });
    toast("Sample profile loaded. It is fictional and labelled as such.");
    this.render();
  },

  async submit() {
    this.collect();
    const problem = this.validate();
    if (problem) return showError(new ApiError(0, "VALIDATION", problem));
    const d = this.draft;
    const body = {
      resume_text: d.resume_text.trim(),
      target_role: d.target_role.trim(),
      current_role: d.current_role.trim() || null,
      hours_per_week: d.hours_per_week,
      jds: d.jds.map((j) => ({ title: j.title, company: j.company, role_family: (j.role_family || d.target_role).trim(), text: j.text })),
    };
    view().innerHTML = Views.obBuilding(BUILD_STEPS);
    const timer = startElapsed();
    const result = await withBusy(null, "", () => api("/api/intake", { method: "POST", body }));
    clearInterval(timer);
    if (!result) return this.render();
    this.reset();
    location.hash = "#/reveal";
    render();
  },
};

function collectJdCards() {
  return [...document.querySelectorAll(".jd-card")].map((card) => ({
    title: card.querySelector("[name=title]").value.trim(),
    company: card.querySelector("[name=company]").value.trim(),
    role_family: card.querySelector("[name=role_family]").value.trim(),
    text: card.querySelector("[name=text]").value.trim(),
  }));
}

const onboardingActions = {
  "ob-start": () => { Onboarding.update({ step: 1 }); Onboarding.render(); },
  "ob-sample": (el) => Onboarding.loadSample(el),
  "ob-next": () => Onboarding.next(),
  "ob-back": () => Onboarding.back(),
  "ob-submit": () => Onboarding.submit(),
  "ob-role": (el) => {
    Onboarding.collect();
    Onboarding.update({ target_role: el.dataset.role });
    document.getElementById("ob-custom-role").value = "";
    document.querySelectorAll("[data-action=ob-role]").forEach((b) => b.setAttribute("aria-pressed", String(b === el)));
  },
  "ob-source": (el) => {
    Onboarding.collect();
    if (el.dataset.source === "sample") return Onboarding.loadSample(el).then(() => { Onboarding.update({ step: 2 }); Onboarding.render(); });
    Onboarding.update({ source: el.dataset.source });
    Onboarding.render();
  },
  "ob-add-jd": () => {
    Onboarding.collect();
    if (Onboarding.draft.jds.length >= 6) return toast("Up to 6 postings.");
    Onboarding.update({ jds: [...Onboarding.draft.jds, {}] });
    Onboarding.render();
    const cards = document.querySelectorAll(".jd-card [name=title]");
    cards[cards.length - 1].focus();
  },
  "ob-remove-jd": (el) => {
    Onboarding.collect();
    const index = Number(el.dataset.index);
    Onboarding.update({ jds: Onboarding.draft.jds.filter((_, i) => i !== index) });
    Onboarding.render();
  },
};

document.addEventListener("input", (event) => {
  const el = event.target;
  if (el.id === "ob-hours") document.getElementById("ob-hours-out").textContent = `${el.value} h`;
  if (el.id === "ob-custom-role" && el.value.trim()) {
    document.querySelectorAll("[data-action=ob-role]").forEach((b) => b.setAttribute("aria-pressed", "false"));
  }
  if (el.id === "ob-resume") document.getElementById("ob-resume-count").textContent = `${words(el.value)} words · at least ${MIN_TEXT} characters`;
});

document.addEventListener("change", (event) => {
  const el = event.target;
  if (el.id !== "ob-file" || !el.files.length) return;
  const file = el.files[0];
  if (file.size > MAX_UPLOAD_BYTES) return showError(new ApiError(0, "VALIDATION", "That file is larger than 200 KB. Paste the resume text instead."));
  const reader = new FileReader();
  reader.onload = () => {
    document.getElementById("ob-resume").value = String(reader.result);
    Onboarding.update({ resume_text: String(reader.result) });
    toast(`Loaded ${file.name}.`);
  };
  reader.onerror = () => showError(new ApiError(0, "CLIENT", "Could not read that file. Paste the text instead."));
  reader.readAsText(file);
});
