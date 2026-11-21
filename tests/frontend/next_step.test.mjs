// Run: node --test tests/frontend
// Loads static/ui.js in a sandbox and checks the shared "next step" resolver every view relies on.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../../static/ui.js", import.meta.url), "utf8");
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(`${source}\nthis.nextPlanStep = nextPlanStep; this.isStepCovered = isStepCovered; this.canAssessRow = canAssessRow; this.decisionState = decisionState;`, sandbox);

const row = (skill_id, level, contested = false) => ({ skill_id, name: skill_id, level, contested });
const item = (skill_id, action) => ({ skill_id, skill: skill_id, action, hours: 4, detail: "", why: { level: "none", demand: "" } });
const state = (ledger, weeks) => ({ ledger, plan: { plan: { weeks } } });

test("skips plan steps already covered by newer evidence", () => {
  const s = state(
    [row("git", "artifact_backed"), row("python", "demonstrated"), row("sql", "claimed")],
    [{ week: 1, items: [item("git", "learn"), item("python", "prove")] }, { week: 2, items: [item("sql", "prove")] }],
  );
  const next = sandbox.nextPlanStep(s);
  assert.equal(next.item.skill_id, "sql");
  assert.equal(next.item.week, 2);
  assert.equal(next.covered, 2);
});

test("a demonstrated skill still needs its artifact step", () => {
  assert.equal(sandbox.isStepCovered(item("python", "artifact"), row("python", "demonstrated")), false);
  assert.equal(sandbox.isStepCovered(item("python", "prove"), row("python", "demonstrated")), true);
});

test("a contested skill is never treated as covered or as finished", () => {
  assert.equal(sandbox.isStepCovered(item("sql", "remediate"), row("sql", "demonstrated", true)), false);
  assert.equal(sandbox.canAssessRow(row("sql", "demonstrated", true)), true);
});

test("only claims, partials and contested skills offer an assessment CTA", () => {
  assert.equal(sandbox.canAssessRow(row("a", "claimed")), true);
  assert.equal(sandbox.canAssessRow(row("a", "none")), false);
  assert.equal(sandbox.canAssessRow(row("a", "demonstrated")), false);
});

test("a proposal replaced before any decision is never reported as accepted", () => {
  assert.equal(sandbox.decisionState({ status: "superseded", decided_at: null }), "replaced");
  assert.equal(sandbox.decisionState({ status: "superseded", decided_at: "2026-11-21T14:00:00+00:00" }), "superseded");
  assert.equal(sandbox.decisionState({ status: "rejected", decided_at: "2026-11-21T14:00:00+00:00" }), "rejected");
  assert.equal(sandbox.decisionState({ status: "proposed", decided_at: null }), "proposed");
});

test("an empty or fully covered plan yields no next step", () => {
  const next = sandbox.nextPlanStep(state([row("git", "artifact_backed")], [{ week: 1, items: [item("git", "learn")] }]));
  assert.equal(next.item, null);
  assert.equal(next.covered, 1);
});
