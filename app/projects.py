"""Portfolio projects mapped to gaps, artifact linking and grounded artifact review."""

import math

from app import db, grounding, ledger, prompts
from app.agent import current_ledger
from app.assessment import run_followup
from app.llm import LLMFailed, get_engine
from app.schemas import ArtifactReview, ProjectSuggestions

TOP_GAPS = 5
MIN_REVIEW_CHARS = 200
PASS_FRACTION = 0.75


def suggest_projects() -> list[dict]:
    with db.connect() as conn:
        profile = db.one(conn, "SELECT target_role FROM profile WHERE id = 1")
        if not profile:
            raise LookupError("Complete intake first.")
        gaps = [r for r in current_ledger(conn) if r["level"] != "artifact_backed"][:TOP_GAPS]
    if not gaps:
        raise LookupError("No open gaps to build projects for.")
    allowed = {g["skill_id"] for g in gaps}
    result = get_engine().structured(
        task="Suggest portfolio projects",
        system=prompts.PROJECT_SUGGESTION,
        user=f"Target role: {profile['target_role']}\nGaps (skill_id: name, evidence level):\n"
             + "\n".join(f"- {g['skill_id']}: {g['name']} ({g['level_label']})" for g in gaps),
        schema=ProjectSuggestions,
    )
    kept = []
    for p in result.projects:
        skill_ids = sorted({s for s in p.skill_ids if s in allowed})
        criteria = [c.strip() for c in p.acceptance_criteria if c.strip()][:4]
        if skill_ids and len(criteria) >= 2 and p.title.strip():
            kept.append((p.title.strip(), p.brief.strip(), skill_ids, criteria))
    if not kept:
        raise LLMFailed("No suggested project mapped to a real gap. Nothing was saved.")
    with db.connect() as conn:
        conn.execute("DELETE FROM projects WHERE id NOT IN (SELECT project_id FROM artifacts)")
        for title, brief, skill_ids, criteria in kept:
            conn.execute(
                "INSERT INTO projects (title, brief, skill_ids, acceptance, created_at) VALUES (?, ?, ?, ?, ?)",
                (title, brief, db.dumps(skill_ids), db.dumps(criteria), db.now()),
            )
        return list_projects(conn)


def list_projects(conn) -> list[dict]:
    names = {s["id"]: s["name"] for s in db.rows(conn, "SELECT id, name FROM skills")}
    out = []
    for p in db.rows(conn, "SELECT * FROM projects ORDER BY id"):
        artifacts = db.rows(conn, "SELECT id, url, review_status, review, created_at, reviewed_at FROM artifacts WHERE project_id = ? ORDER BY id", (p["id"],))
        skill_ids = db.loads(p["skill_ids"], [])
        out.append({
            **p,
            "skill_ids": skill_ids,
            "skills": [{"skill_id": s, "name": names.get(s, s)} for s in skill_ids],
            "acceptance": db.loads(p["acceptance"], []),
            "artifacts": [{**a, "review": db.loads(a["review"], None)} for a in artifacts],
        })
    return out


def link_artifact(project_id: int, url: str, submitted_text: str) -> dict:
    with db.connect() as conn:
        project = db.one(conn, "SELECT * FROM projects WHERE id = ?", (project_id,))
        if not project:
            raise LookupError("Project not found.")
        skill_ids = db.loads(project["skill_ids"], [])
        befores = {s: ledger.skill_state(conn, s) for s in skill_ids}
        cur = conn.execute(
            "INSERT INTO artifacts (project_id, skill_ids, url, submitted_text, review_status, created_at) VALUES (?, ?, ?, ?, 'unreviewed', ?)",
            (project_id, project["skill_ids"], url, submitted_text, db.now()),
        )
        artifact_id = cur.lastrowid
        for sid in skill_ids:
            ledger.record_event(conn, sid, "artifact_linked", f"artifact:{artifact_id}:linked", befores[sid],
                                "Artifact linked but unreviewed. It does not count as evidence yet.")
        return {"artifact_id": artifact_id, "review_status": "unreviewed"}


def review_artifact(artifact_id: int) -> dict:
    with db.connect() as conn:
        artifact = db.one(conn, "SELECT * FROM artifacts WHERE id = ?", (artifact_id,))
        if not artifact:
            raise LookupError("Artifact not found.")
        project = db.one(conn, "SELECT * FROM projects WHERE id = ?", (artifact["project_id"],))
    if artifact["review_status"] != "unreviewed":
        return {"artifact_id": artifact_id, "review_status": artifact["review_status"], "duplicate": True, "proposal": None, "agent": None}
    text = artifact["submitted_text"]
    if len(text.strip()) < MIN_REVIEW_CHARS:
        raise ValueError(
            f"Paste at least {MIN_REVIEW_CHARS} characters of the README, write-up or code. "
            "Links are not fetched, so an unreviewed link cannot count as evidence."
        )
    acceptance = db.loads(project["acceptance"], [])
    review = get_engine().structured(
        task="Review artifact",
        system=prompts.ARTIFACT_REVIEW,
        user="Acceptance criteria:\n" + "\n".join(f"- {c}" for c in acceptance) + f"\n<submission>\n{text}\n</submission>",
        schema=ArtifactReview,
        effort="medium",
    )
    checked = _verify_review(review, acceptance, text)
    met = sum(1 for c in checked if c["met"])
    status = "passed" if met >= math.ceil(PASS_FRACTION * len(acceptance)) else "failed"
    skill_ids = db.loads(artifact["skill_ids"], [])
    event_ids = []
    with db.connect() as conn:
        befores = {s: ledger.skill_state(conn, s) for s in skill_ids}
        conn.execute(
            "UPDATE artifacts SET review_status = ?, review = ?, reviewed_at = ? WHERE id = ? AND review_status = 'unreviewed'",
            (status, db.dumps({"criteria": checked, "summary": review.summary.strip(), "met": met, "of": len(acceptance)}), db.now(), artifact_id),
        )
        for sid in skill_ids:
            eid = ledger.record_event(conn, sid, "artifact_review", f"artifact:{artifact_id}:review", befores[sid],
                                      f"Artifact review {status}: {met}/{len(acceptance)} criteria met with quoted evidence.")
            event_ids.append(eid)
    context = f"Artifact {artifact_id} review {status} ({met}/{len(acceptance)}). Skills: {', '.join(skill_ids)}. Evidence event ids: {event_ids}."
    return {"artifact_id": artifact_id, "review_status": status, "criteria": checked, "duplicate": False, **run_followup("after_artifact", context)}


def _verify_review(review: ArtifactReview, acceptance: list[str], text: str) -> list[dict]:
    by_name = {grounding.normalize_text(c.criterion): c for c in review.criteria}
    same_length = len(review.criteria) == len(acceptance)
    checked = []
    for index, criterion in enumerate(acceptance):
        c = by_name.get(grounding.normalize_text(criterion)) or (review.criteria[index] if same_length else None)
        if c is None:
            checked.append({"criterion": criterion, "met": False, "evidence_quote": "", "note": "Not reviewed.", "verification": "missing"})
            continue
        entry = {"criterion": criterion, "met": c.met, "evidence_quote": c.evidence_quote.strip(), "note": c.note.strip(), "verification": "n/a"}
        if c.met:
            ok, why = grounding.verify_evidence_quote(c.evidence_quote, text)
            entry["verification"] = "verified" if ok else why
            entry["met"] = ok
        checked.append(entry)
    return checked
