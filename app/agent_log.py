"""Human-readable agent activity log."""

import uuid

from app import db


def new_run_id() -> str:
    return uuid.uuid4().hex[:10]


def log_entry(conn, run_id: str, trigger: str, actor: str, action: str, detail: dict) -> None:
    conn.execute(
        "INSERT INTO agent_log (ts, run_id, trigger, actor, action, detail) VALUES (?, ?, ?, ?, ?, ?)",
        (db.now(), run_id, trigger, actor, action, db.dumps(detail)),
    )


def recent(conn, limit: int = 100) -> list[dict]:
    entries = db.rows(conn, "SELECT * FROM agent_log ORDER BY id DESC LIMIT ?", (limit,))
    return [{**e, "detail": db.loads(e["detail"], {})} for e in entries]
