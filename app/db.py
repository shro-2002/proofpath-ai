"""SQLite persistence. One file, one connection per call, explicit schema."""

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    resume_text TEXT NOT NULL,
    target_role TEXT NOT NULL,
    hours_per_week INTEGER NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS job_descriptions (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    role_family TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS requirements (
    id INTEGER PRIMARY KEY,
    jd_id INTEGER NOT NULL REFERENCES job_descriptions(id),
    skill_id TEXT NOT NULL REFERENCES skills(id),
    quote TEXT NOT NULL,
    importance TEXT NOT NULL CHECK (importance IN ('must', 'nice')),
    UNIQUE (jd_id, skill_id)
);
CREATE TABLE IF NOT EXISTS claims (
    id INTEGER PRIMARY KEY,
    skill_id TEXT NOT NULL REFERENCES skills(id),
    quote TEXT NOT NULL,
    match TEXT NOT NULL CHECK (match IN ('explicit', 'inferred')),
    UNIQUE (skill_id, quote)
);
CREATE TABLE IF NOT EXISTS rejected_items (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    skill_name TEXT NOT NULL,
    quote TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assessments (
    id INTEGER PRIMARY KEY,
    skill_id TEXT NOT NULL REFERENCES skills(id),
    question TEXT NOT NULL,
    key_points TEXT NOT NULL,
    selection_reason TEXT NOT NULL,
    selected_by TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'graded')),
    answer TEXT,
    answer_hash TEXT,
    criteria TEXT,
    total INTEGER,
    max_total INTEGER,
    outcome TEXT,
    flags TEXT,
    feedback TEXT,
    created_at TEXT NOT NULL,
    answered_at TEXT
);
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    brief TEXT NOT NULL,
    skill_ids TEXT NOT NULL,
    acceptance TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    skill_ids TEXT NOT NULL,
    url TEXT NOT NULL,
    submitted_text TEXT NOT NULL,
    review_status TEXT NOT NULL CHECK (review_status IN ('unreviewed', 'passed', 'failed')),
    review TEXT,
    created_at TEXT NOT NULL,
    reviewed_at TEXT
);
CREATE TABLE IF NOT EXISTS evidence_events (
    id INTEGER PRIMARY KEY,
    skill_id TEXT NOT NULL REFERENCES skills(id),
    kind TEXT NOT NULL,
    source_ref TEXT NOT NULL,
    before_level TEXT NOT NULL,
    after_level TEXT NOT NULL,
    before_strength REAL NOT NULL,
    after_strength REAL NOT NULL,
    note TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (skill_id, source_ref)
);
CREATE TABLE IF NOT EXISTS plan_versions (
    id INTEGER PRIMARY KEY,
    version INTEGER NOT NULL,
    base_version INTEGER,
    status TEXT NOT NULL CHECK (status IN ('active', 'proposed', 'superseded', 'rejected')),
    plan TEXT NOT NULL,
    diff TEXT,
    reason TEXT NOT NULL,
    cited_events TEXT NOT NULL,
    trigger TEXT NOT NULL,
    created_at TEXT NOT NULL,
    decided_at TEXT
);
CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY,
    company TEXT NOT NULL,
    role_title TEXT NOT NULL,
    role_family TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('applied', 'no_response', 'rejected', 'interview', 'offer')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_log (
    id INTEGER PRIMARY KEY,
    ts TEXT NOT NULL,
    run_id TEXT NOT NULL,
    trigger TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT NOT NULL
);
"""

WORKSPACE_TABLES = (
    "agent_log", "applications", "plan_versions", "evidence_events", "artifacts",
    "projects", "assessments", "rejected_items", "claims", "requirements", "skills",
    "job_descriptions", "profile",
)


def db_path() -> Path:
    return Path(os.environ.get("PROOFPATH_DB", "data/proofpath.db"))


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def connect():
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)


def reset_workspace(conn: sqlite3.Connection) -> None:
    for table in WORKSPACE_TABLES:
        conn.execute(f"DELETE FROM {table}")  # table names are constants, not input


def rows(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> list[dict]:
    return [dict(r) for r in conn.execute(sql, params).fetchall()]


def one(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> dict | None:
    row = conn.execute(sql, params).fetchone()
    return dict(row) if row else None


def dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def loads(value: str | None, default=None):
    return json.loads(value) if value else default
