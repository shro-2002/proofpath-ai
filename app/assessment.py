"""Mock interviews: question generation, rubric grading, deterministic scoring, ledger update."""

import hashlib

from app import db, grounding, ledger, prompts
from app.agent import run_agent
from app.agent_log import log_entry, new_run_id
from app.llm import LLMFailed, LLMUnavailable, get_engine
from app.schemas import RUBRIC, GeneratedQuestion, GradeResult

POINTS = {"met": 2, "partial": 1, "not_met": 0}
MAX_TOTAL = 2 * len(RUBRIC)
PASS_TOTAL = 6
PARTIAL_TOTAL = 3
MIN_SUBSTANTIVE_WORDS = 25
OUTCOME_RANK = {"fail": 0, "partial": 1, "pass": 2}


class AlreadyAnswered(Exception):
    pass


def start_assessment(skill_id: str, selected_by: str, reason: str) -> dict:
    with db.connect() as conn:
        skill = db.one(conn, "SELECT id, name FROM skills WHERE id = ?", (skill_id,))
        if not skill:
            raise LookupError(f"Unknown skill '{skill_id}'.")
        profile = db.one(conn, "SELECT target_role FROM profile WHERE id = 1")
        quotes = [r["quote"] for r in db.rows(conn, "SELECT quote FROM requirements WHERE skill_id = ? LIMIT 3", (skill_id,))]
    generated = get_engine().structured(
        task=f"Write a question for {skill['name']}",
        system=prompts.QUESTION_GENERATION,
        user=(
            f"Target role: {profile['target_role']}\nSkill: {skill['name']}\n"
            "How postings describe it:\n" + "\n".join(f"- {q}" for q in quotes)
        ),
        schema=GeneratedQuestion,
        effort="low",
    )
    key_points = [p.strip() for p in generated.key_points if p.strip()][:4]
    if not generated.question.strip() or len(key_points) < 2:
        raise LLMFailed("Question generation returned an incomplete question.")
    with db.connect() as conn:
        cur = conn.execute(
            """INSERT INTO assessments (skill_id, question, key_points, selection_reason, selected_by, status, created_at)
               VALUES (?, ?, ?, ?, ?, 'open', ?)""",
            (skill_id, generated.question.strip(), db.dumps(key_points), reason, selected_by, db.now()),
        )
        return get_assessment(conn, cur.lastrowid)


def next_assessment() -> dict:
    with db.connect() as conn:
        if not db.one(conn, "SELECT id FROM profile WHERE id = 1"):
            raise LookupError("Complete intake first.")
    run = run_agent("select_probe", "Pick the next skill to probe.")
    if not run.selection:
        raise LLMFailed("The agent did not select a skill to assess.")
    return start_assessment(run.selection["skill_id"], "agent", run.selection["reason"])


def get_assessment(conn, assessment_id: int) -> dict | None:
    row = db.one(
        conn,
        "SELECT a.*, s.name AS skill_name FROM assessments a JOIN skills s ON s.id = a.skill_id WHERE a.id = ?",
        (assessment_id,),
    )
    if not row:
        return None
    return {
        **row,
        "key_points": db.loads(row["key_points"], []),
        "criteria": db.loads(row["criteria"], []),
        "flags": db.loads(row["flags"], []),
    }


def score(criteria: list[dict], answer: str) -> tuple[int, str, list[str]]:
    """Deterministic total and outcome from verified criterion ratings, with guard caps."""
    flags: list[str] = []
    total = sum(POINTS[c["rating"]] for c in criteria)
    by_name = {c["criterion"]: c["rating"] for c in criteria}
    if total >= PASS_TOTAL and by_name.get("correctness") == "met":
        outcome = "pass"
    elif total >= PARTIAL_TOTAL:
        outcome = "partial"
    else:
        outcome = "fail"
    if grounding.looks_keyword_stuffed(answer):
        flags.append("keyword_stuffing")
    if grounding.word_count(answer) < MIN_SUBSTANTIVE_WORDS:
        flags.append("too_short")
    if flags and outcome == "pass":
        outcome = "partial"
    if grounding.detect_injection(answer):
        flags.append("prompt_injection_ignored")
    return total, outcome, flags


def verify_criteria(grade: GradeResult, answer: str) -> list[dict]:
    """Keep one judgment per rubric criterion; downgrade any met/partial whose quote is not real."""
    by_name = {c.criterion: c for c in grade.criteria}
    verified = []
    for name in RUBRIC:
        c = by_name.get(name)
        if c is None:
            verified.append({"criterion": name, "rating": "not_met", "evidence_quote": "", "feedback": "Not assessed by the grader.", "verification": "missing"})
            continue
        entry = {"criterion": name, "rating": c.rating, "evidence_quote": c.evidence_quote.strip(), "feedback": c.feedback.strip(), "verification": "n/a"}
        if c.rating != "not_met":
            ok, why = grounding.verify_evidence_quote(c.evidence_quote, answer)
            entry["verification"] = "verified" if ok else why
            if not ok:
                entry["rating"] = "not_met"
                entry["feedback"] = f"{entry['feedback']} (Downgraded: {why}.)".strip()
        verified.append(entry)
    return verified


def submit_answer(assessment_id: int, answer: str) -> dict:
    answer = answer.strip()
    answer_hash = hashlib.sha256(answer.encode()).hexdigest()
    with db.connect() as conn:
        current = get_assessment(conn, assessment_id)
    if not current:
        raise LookupError("Assessment not found.")
    if current["status"] == "graded":
        if current["answer_hash"] == answer_hash:
            return {"assessment": current, "duplicate": True, "proposal": None, "agent": None}
        raise AlreadyAnswered("This question was already answered. Start a new assessment to try again.")

    grade = get_engine().structured(
        task="Grade answer",
        system=prompts.GRADING,
        user=(
            f"Question: {current['question']}\nKey points a strong answer covers:\n"
            + "\n".join(f"- {p}" for p in current["key_points"])
            + f"\n<candidate_answer>\n{answer}\n</candidate_answer>"
        ),
        schema=GradeResult,
        effort="medium",
    )
    criteria = verify_criteria(grade, answer)
    total, outcome, flags = score(criteria, answer)

    with db.connect() as conn:
        before = ledger.skill_state(conn, current["skill_id"])
        updated = conn.execute(
            """UPDATE assessments SET status = 'graded', answer = ?, answer_hash = ?, criteria = ?, total = ?,
               max_total = ?, outcome = ?, flags = ?, feedback = ?, answered_at = ? WHERE id = ? AND status = 'open'""",
            (answer, answer_hash, db.dumps(criteria), total, MAX_TOTAL, outcome, db.dumps(flags),
             grade.overall_feedback.strip(), db.now(), assessment_id),
        ).rowcount
        if not updated:  # a concurrent submission won the race
            return {"assessment": get_assessment(conn, assessment_id), "duplicate": True, "proposal": None, "agent": None}
        note = f"Assessment {outcome} ({total}/{MAX_TOTAL})" + (f"; flags: {', '.join(flags)}" if flags else "")
        event_id = ledger.record_event(conn, current["skill_id"], "assessment", f"assessment:{assessment_id}", before, note)
        after = ledger.skill_state(conn, current["skill_id"])
        result = get_assessment(conn, assessment_id)

    context = (
        f"Skill {current['skill_id']} assessed: outcome {outcome}, {total}/{MAX_TOTAL}. "
        f"Evidence event id {event_id}. Level {before.level} -> {after.level}, strength {before.strength} -> {after.strength}. "
        f"Weak criteria: {', '.join(c['criterion'] for c in criteria if c['rating'] != 'met') or 'none'}."
    )
    return {"assessment": result, "duplicate": False, "event_id": event_id, **run_followup("after_assessment", context)}


def run_followup(trigger: str, context: str) -> dict:
    """Run the agent after evidence changed. Agent failure is reported, never hidden; evidence stays recorded."""
    try:
        run = run_agent(trigger, context)
        return {"proposal": run.proposal, "agent": {"run_id": run.run_id, "error": None}}
    except (LLMFailed, LLMUnavailable) as exc:
        with db.connect() as conn:
            log_entry(conn, new_run_id(), trigger, "system", "agent_failed", {"error": str(exc)})
        return {"proposal": None, "agent": {"run_id": None, "error": str(exc)}}


def list_assessments(conn) -> list[dict]:
    ids = [r["id"] for r in db.rows(conn, "SELECT id FROM assessments ORDER BY id DESC")]
    return [get_assessment(conn, i) for i in ids]
