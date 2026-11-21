"""FastAPI app: thin routes over the ledger services. Serves the static frontend."""

import json
import logging
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app import agent_log, applications, assessment, db, planner, projects
from app.agent import candidate_plan, current_ledger
from app.assessment import AlreadyAnswered, run_followup
from app.intake import run_intake
from app.llm import LLMFailed, LLMUnavailable, engine_status
from app.schemas import (
    AnswerRequest, ApplicationCreate, ApplicationUpdate, ArtifactRequest, IntakeRequest, StartAssessmentRequest,
)

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"
DEMO = ROOT / "demo_data"
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("proofpath")


def load_env_file(path: Path) -> None:
    """Minimal .env loader (KEY=VALUE lines). Existing environment variables win."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


def create_app() -> FastAPI:
    load_env_file(ROOT / ".env")
    db.init_db()
    app = FastAPI(title="ProofPath AI", version="1.0.0")

    @app.exception_handler(LLMUnavailable)
    async def _unavailable(_: Request, exc: LLMUnavailable):
        return error(503, "LLM_UNAVAILABLE", str(exc))

    @app.exception_handler(LLMFailed)
    async def _failed(_: Request, exc: LLMFailed):
        log.warning("LLM failure: %s", exc)
        return error(502, "LLM_FAILED", str(exc))

    @app.exception_handler(LookupError)
    async def _missing(_: Request, exc: LookupError):
        return error(404, "NOT_FOUND", str(exc).strip("'\""))

    @app.exception_handler(ValueError)
    async def _invalid(_: Request, exc: ValueError):
        return error(400, "INVALID_INPUT", str(exc))

    @app.exception_handler(AlreadyAnswered)
    async def _answered(_: Request, exc: AlreadyAnswered):
        return error(409, "ALREADY_ANSWERED", str(exc))

    @app.exception_handler(planner.StaleProposal)
    async def _stale(_: Request, exc: planner.StaleProposal):
        return error(409, "STALE_PROPOSAL", str(exc))

    register_routes(app)
    app.mount("/static", StaticFiles(directory=STATIC), name="static")
    return app


def register_routes(app: FastAPI) -> None:
    @app.get("/")
    def index():
        return FileResponse(STATIC / "index.html")

    @app.get("/health")
    def health():
        return {"status": "ok", "llm": engine_status()}

    @app.get("/api/state")
    def state():
        with db.connect() as conn:
            profile = db.one(conn, "SELECT target_role, hours_per_week, created_at FROM profile WHERE id = 1")
            if not profile:
                return {"llm": engine_status(), "profile": None}
            active = planner.active_plan(conn)
            return {
                "llm": engine_status(),
                "profile": profile,
                "jds": db.rows(conn, "SELECT id, title, company, role_family FROM job_descriptions ORDER BY id"),
                "ledger": current_ledger(conn),
                "plan": active,
                "proposal": planner.pending_proposal(conn),
                "rejected_count": conn.execute("SELECT COUNT(*) FROM rejected_items").fetchone()[0],
                "counts": {
                    "assessments": conn.execute("SELECT COUNT(*) FROM assessments WHERE status = 'graded'").fetchone()[0],
                    "artifacts_reviewed": conn.execute("SELECT COUNT(*) FROM artifacts WHERE review_status != 'unreviewed'").fetchone()[0],
                    "applications": conn.execute("SELECT COUNT(*) FROM applications").fetchone()[0],
                    "plan_versions": conn.execute("SELECT COUNT(*) FROM plan_versions WHERE status IN ('active','superseded')").fetchone()[0],
                },
            }

    @app.get("/api/demo-data")
    def demo_data():
        return json.loads((DEMO / "sample.json").read_text())

    @app.post("/api/intake")
    def intake(req: IntakeRequest):
        return run_intake(req)

    @app.post("/api/reset")
    def reset():
        with db.connect() as conn:
            db.reset_workspace(conn)
        return {"status": "reset"}

    @app.get("/api/skills/{skill_id}")
    def skill_detail(skill_id: str):
        with db.connect() as conn:
            row = next((r for r in current_ledger(conn) if r["skill_id"] == skill_id), None)
            if not row:
                raise LookupError(f"Unknown skill '{skill_id}'.")
            return {
                **row,
                "requirements": db.rows(conn, """SELECT r.quote, r.importance, j.title, j.company, j.role_family, j.id AS jd_id
                                                FROM requirements r JOIN job_descriptions j ON j.id = r.jd_id
                                                WHERE r.skill_id = ? ORDER BY j.id""", (skill_id,)),
                "claims": db.rows(conn, "SELECT id, quote, match FROM claims WHERE skill_id = ?", (skill_id,)),
                "assessments": [a for a in assessment.list_assessments(conn) if a["skill_id"] == skill_id],
                "artifacts": [
                    {**a, "review": db.loads(a["review"], None)}
                    for a in db.rows(conn, "SELECT id, project_id, url, review_status, review, skill_ids, created_at FROM artifacts ORDER BY id")
                    if skill_id in db.loads(a["skill_ids"], [])
                ],
                "events": db.rows(conn, "SELECT * FROM evidence_events WHERE skill_id = ? ORDER BY id DESC", (skill_id,)),
            }

    @app.get("/api/rejected")
    def rejected():
        with db.connect() as conn:
            return db.rows(conn, "SELECT * FROM rejected_items ORDER BY id")

    @app.get("/api/assessments")
    def list_assessments():
        with db.connect() as conn:
            return assessment.list_assessments(conn)

    @app.post("/api/assessments/next")
    def next_assessment():
        return assessment.next_assessment()

    @app.post("/api/assessments")
    def start_assessment(req: StartAssessmentRequest):
        return assessment.start_assessment(req.skill_id, "user", "You chose this skill from the evidence ledger.")

    @app.post("/api/assessments/{assessment_id}/answer")
    def answer(assessment_id: int, req: AnswerRequest):
        return assessment.submit_answer(assessment_id, req.answer)

    @app.get("/api/plan")
    def plan():
        with db.connect() as conn:
            versions = db.rows(conn, "SELECT id, version, base_version, status, reason, trigger, cited_events, created_at, decided_at FROM plan_versions ORDER BY version DESC")
            return {"active": planner.active_plan(conn), "proposal": planner.pending_proposal(conn), "versions": versions}

    @app.post("/api/plan/proposals/{proposal_id}/accept")
    def accept(proposal_id: int):
        with db.connect() as conn:
            result = planner.decide_proposal(conn, proposal_id, accept=True)
            agent_log.log_entry(conn, agent_log.new_run_id(), "user", "user", "accepted_plan", result)
            return result

    @app.post("/api/plan/proposals/{proposal_id}/reject")
    def reject(proposal_id: int):
        with db.connect() as conn:
            result = planner.decide_proposal(conn, proposal_id, accept=False)
            agent_log.log_entry(conn, agent_log.new_run_id(), "user", "user", "rejected_plan", result)
            return result

    @app.get("/api/projects")
    def list_projects():
        with db.connect() as conn:
            return projects.list_projects(conn)

    @app.post("/api/projects/generate")
    def generate_projects():
        return projects.suggest_projects()

    @app.post("/api/projects/{project_id}/artifacts")
    def link_artifact(project_id: int, req: ArtifactRequest):
        return projects.link_artifact(project_id, str(req.url), req.submitted_text)

    @app.post("/api/artifacts/{artifact_id}/review")
    def review_artifact(artifact_id: int):
        return projects.review_artifact(artifact_id)

    @app.get("/api/applications")
    def list_applications():
        with db.connect() as conn:
            return {
                "applications": db.rows(conn, "SELECT * FROM applications ORDER BY id DESC"),
                "insights": applications.insights(conn),
            }

    @app.post("/api/applications")
    def create_application(req: ApplicationCreate):
        with db.connect() as conn:
            cur = conn.execute(
                "INSERT INTO applications (company, role_title, role_family, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (req.company, req.role_title, req.role_family.strip(), req.status, db.now(), db.now()),
            )
            app_id = cur.lastrowid
        return {"id": app_id, **_after_application()}

    @app.patch("/api/applications/{app_id}")
    def update_application(app_id: int, req: ApplicationUpdate):
        with db.connect() as conn:
            if not conn.execute("UPDATE applications SET status = ?, updated_at = ? WHERE id = ?", (req.status, db.now(), app_id)).rowcount:
                raise LookupError("Application not found.")
        return {"id": app_id, **_after_application()}

    @app.get("/api/activity")
    def activity():
        with db.connect() as conn:
            return agent_log.recent(conn, 150)


def _after_application() -> dict:
    """Deterministic gate: the agent only runs when the data supports a pattern and the plan would change."""
    with db.connect() as conn:
        insight = applications.insights(conn)
        has_profile = db.one(conn, "SELECT id FROM profile WHERE id = 1") is not None
        diff_empty = candidate_plan(conn)[1]["is_empty"] if has_profile else True
        if not insight["signal"] or diff_empty:
            agent_log.log_entry(conn, agent_log.new_run_id(), "after_application", "system", "no_change", {
                "reason": insight["message"] if not insight["signal"] else "Signal found, but the computed plan is unchanged.",
                "total_outcomes": insight["total_outcomes"],
            })
            return {"insights": insight, "proposal": None, "agent": None}
    context = f"Application insights: {insight['message']} Signal: {insight['signal']}."
    return {"insights": insight, **run_followup("after_application", context)}


app = create_app()
