"""Single coach agent with structured tools.

The agent decides; code validates and executes. Every tool call is written to the activity log.
"""

import re
from dataclasses import dataclass, field

from app import applications, db, ledger, planner, prompts
from app.agent_log import log_entry, new_run_id
from app.llm import ToolSpec, get_engine

READINESS_CLAIMS = re.compile(r"\b(job[- ]ready|ready for (the|this|a) (job|role)|qualified for|certif(y|ied))\b", re.I)


@dataclass
class AgentRun:
    trigger: str
    run_id: str = field(default_factory=new_run_id)
    selection: dict | None = None
    proposal: dict | None = None
    preview: dict | None = None


def current_ledger(conn) -> list[dict]:
    return ledger.ledger_rows(conn, applications.response_weights(conn))


def candidate_plan(conn) -> tuple[dict, dict, dict | None]:
    """(candidate plan, diff vs active, active plan record)."""
    profile = db.one(conn, "SELECT hours_per_week FROM profile WHERE id = 1")
    candidate = planner.build_plan(current_ledger(conn), profile["hours_per_week"])
    active = planner.active_plan(conn)
    diff = planner.diff_plans(active["plan"] if active else {}, candidate)
    return candidate, diff, active


def _summary_row(r: dict) -> dict:
    return {
        "skill_id": r["skill_id"], "name": r["name"], "level": r["level"], "strength": r["strength"],
        "uncertainty": r["uncertainty"], "contested": r["contested"], "priority": r["priority"],
        "demand": f"{r['demand']['jd_count']}/{r['demand']['jd_total']} postings",
        "last_outcome": r["last_outcome"],
    }


def _tools(run: AgentRun) -> list[ToolSpec]:
    def logged(name, fn):
        def handler(args: dict) -> dict:
            try:
                result = fn(args)
            except Exception as exc:  # tool errors go back to the model and the log, never swallowed
                result = {"error": str(exc)}
            with db.connect() as conn:
                log_entry(conn, run.run_id, run.trigger, "agent", name, {"input": args, "result": _brief(result)})
            return result
        return handler

    def get_ledger_summary(_):
        with db.connect() as conn:
            return {"skills": [_summary_row(r) for r in current_ledger(conn)]}

    def get_skill_evidence(args):
        with db.connect() as conn:
            sid = args["skill_id"]
            if not db.one(conn, "SELECT id FROM skills WHERE id = ?", (sid,)):
                return {"error": f"unknown skill_id {sid}"}
            events = db.rows(conn, "SELECT id, kind, before_level, after_level, note, created_at FROM evidence_events WHERE skill_id = ? ORDER BY id", (sid,))
            claims = db.rows(conn, "SELECT quote, match FROM claims WHERE skill_id = ?", (sid,))
            return {"skill_id": sid, "claims": claims, "events": events}

    def select_assessment_target(args):
        with db.connect() as conn:
            row = next((r for r in current_ledger(conn) if r["skill_id"] == args["skill_id"]), None)
        if not row:
            return {"error": f"unknown skill_id {args['skill_id']}"}
        if not args["reason"].strip():
            return {"error": "reason is required"}
        run.selection = {"skill_id": row["skill_id"], "reason": args["reason"].strip()[:400]}
        return {"selected": row["skill_id"]}

    def preview_plan_change(_):
        with db.connect() as conn:
            candidate, diff, active = candidate_plan(conn)
        run.preview = {"plan": candidate, "diff": diff}
        return {"active_version": active["version"] if active else None, "diff": diff}

    def propose_plan_change(args):
        reason = args["reason"].strip()
        if not 10 <= len(reason) <= 400:
            return {"error": "reason must be 10-400 characters"}
        if READINESS_CLAIMS.search(reason):
            return {"error": "reason must describe evidence, not job readiness"}
        with db.connect() as conn:
            candidate, diff, _ = candidate_plan(conn)
            if diff["is_empty"]:
                return {"error": "no plan change: the recomputed plan is identical to the active plan"}
            cited = sorted({int(i) for i in args["cited_event_ids"]})
            known = {r["id"] for r in db.rows(conn, "SELECT id FROM evidence_events")}
            if not set(cited) <= known:
                return {"error": f"unknown evidence event ids: {sorted(set(cited) - known)}"}
            if run.trigger == "after_application":
                if not applications.insights(conn)["signal"]:
                    return {"error": "application data does not support a change (no statistical signal)"}
            elif not cited:
                return {"error": "cite at least one evidence event id"}
            run.proposal = planner.store_proposal(conn, candidate, diff, reason, cited, run.trigger)
        return {"proposal_version": run.proposal["version"], "status": "awaiting user confirmation"}

    def get_application_insights(_):
        with db.connect() as conn:
            return applications.insights(conn)

    empty = {"type": "object", "properties": {}, "required": [], "additionalProperties": False}
    sid_schema = {"type": "object", "properties": {"skill_id": {"type": "string"}}, "required": ["skill_id"], "additionalProperties": False}
    specs = [
        ToolSpec("get_ledger_summary", "List every skill with evidence level, strength, uncertainty, demand and priority.", empty, logged("get_ledger_summary", get_ledger_summary)),
        ToolSpec("get_skill_evidence", "Show claims and evidence events (with ids) for one skill.", sid_schema, logged("get_skill_evidence", get_skill_evidence)),
        ToolSpec("preview_plan_change", "Recompute the plan from the current ledger and diff it against the active plan.", empty, logged("preview_plan_change", preview_plan_change)),
        ToolSpec("propose_plan_change", "Store the recomputed plan as a proposal for the user to accept or reject.", {
            "type": "object",
            "properties": {
                "reason": {"type": "string", "description": "At most two sentences citing the evidence that caused the change."},
                "cited_event_ids": {"type": "array", "items": {"type": "integer"}},
            },
            "required": ["reason", "cited_event_ids"],
            "additionalProperties": False,
        }, logged("propose_plan_change", propose_plan_change)),
        ToolSpec("get_application_insights", "Response statistics by role type, with uncertainty and thresholds.", empty, logged("get_application_insights", get_application_insights)),
    ]
    if run.trigger == "select_probe":
        specs.append(ToolSpec("select_assessment_target", "Choose the skill to assess next and say why.", {
            "type": "object",
            "properties": {"skill_id": {"type": "string"}, "reason": {"type": "string"}},
            "required": ["skill_id", "reason"],
            "additionalProperties": False,
        }, logged("select_assessment_target", select_assessment_target)))
    return specs


def _brief(result: dict) -> dict:
    if "skills" in result:
        return {"skills": len(result["skills"])}
    if "diff" in result:
        d = result["diff"]
        return {"added": len(d["added"]), "removed": len(d["removed"]), "changed": len(d["changed"]), "rescheduled": len(d.get("rescheduled", [])), "is_empty": d["is_empty"]}
    return result


TRIGGER_TASKS = {
    "select_probe": "Choose the single most useful skill to assess next. Inspect the ledger, then call select_assessment_target.",
    "after_assessment": "A new assessment was graded (details below). Check the evidence, preview the plan change, and propose it only if the diff is non-empty and justified by the new evidence.",
    "after_artifact": "An artifact review finished (details below). Check the evidence, preview the plan change, and propose it only if justified.",
    "after_application": "An application outcome was logged. Check application insights. Propose a plan change only if insights report a signal and the preview diff is non-empty.",
}


def run_agent(trigger: str, context: str) -> AgentRun:
    run = AgentRun(trigger=trigger)
    with db.connect() as conn:
        log_entry(conn, run.run_id, trigger, "system", "agent_started", {"context": context[:500]})
    summary = get_engine().run_agent(
        trigger=trigger,
        system=prompts.AGENT_SYSTEM,
        user=f"{TRIGGER_TASKS[trigger]}\n\nContext:\n{context}",
        tools=_tools(run),
    )
    with db.connect() as conn:
        log_entry(conn, run.run_id, trigger, "agent", "summary", {"text": summary[:600]})
    return run
