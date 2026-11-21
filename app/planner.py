"""Deterministic plan construction, versioning and diffs. No LLM here."""

from app import db

MIN_PRIORITY = 0.05
MAX_WEEKS = 8

# Hours to move a skill one meaningful step, by its current evidence state.
HOURS_BY_STATE = {
    "none": 10,
    "contested": 6,
    "claimed": 3,
    "partial": 5,
    "demonstrated": 4,
}

ACTION_BY_STATE = {
    "none": ("learn", "Learn the fundamentals, then produce a small proof of work."),
    "contested": ("remediate", "Rework the criteria you missed, then re-assess."),
    "claimed": ("prove", "Take an assessment to turn the resume claim into demonstrated evidence."),
    "partial": ("strengthen", "Targeted practice on the criteria you missed, then re-assess."),
    "demonstrated": ("artifact", "Ship a portfolio artifact so the skill is backed by reviewable work."),
}


def _state_key(row: dict) -> str | None:
    if row["level"] == "artifact_backed":
        return None
    if row["contested"]:
        return "contested"
    return row["level"]


def _item_for(row: dict) -> dict | None:
    key = _state_key(row)
    if key is None or row["priority"] < MIN_PRIORITY:
        return None
    action, detail = ACTION_BY_STATE[key]
    if key in ("contested", "partial") and row["weak_criteria"]:
        detail = f"{detail} Missed: {', '.join(row['weak_criteria'])}."
    d = row["demand"]
    return {
        "skill_id": row["skill_id"],
        "skill": row["name"],
        "action": action,
        "hours": HOURS_BY_STATE[key],
        "detail": detail,
        "why": {
            "priority": row["priority"],
            "level": row["level"],
            "contested": row["contested"],
            "demand": f"{d['jd_count']} of {d['jd_total']} postings ({d['must_count']} as must-have)",
            "response_weight": row["response_weight"],
        },
    }


def build_plan(ledger: list[dict], hours_per_week: int) -> dict:
    """Pack prioritized gap items into weeks. Items larger than the remaining week continue next week."""
    items = [i for i in (_item_for(r) for r in ledger) if i]
    weeks: list[dict] = []
    backlog: list[dict] = []
    week_items: list[dict] = []
    remaining = hours_per_week
    for item in items:
        hours_left = item["hours"]
        part = 1
        while hours_left > 0:
            if len(weeks) >= MAX_WEEKS:
                backlog.append({**item, "hours": hours_left})
                break
            chunk = min(hours_left, remaining)
            week_items.append({**item, "hours": chunk, "part": part})
            hours_left -= chunk
            remaining -= chunk
            part += 1
            if remaining == 0:
                weeks.append({"week": len(weeks) + 1, "items": week_items})
                week_items, remaining = [], hours_per_week
    if week_items and len(weeks) < MAX_WEEKS:
        weeks.append({"week": len(weeks) + 1, "items": week_items})
    return {"hours_per_week": hours_per_week, "weeks": weeks, "backlog": backlog}


def _flatten(plan: dict) -> dict[str, dict]:
    flat: dict[str, dict] = {}
    for week in plan.get("weeks", []):
        for item in week["items"]:
            entry = flat.setdefault(item["skill_id"], {
                "skill": item["skill"], "action": item["action"], "first_week": week["week"],
                "hours": 0, "detail": item["detail"],
            })
            entry["hours"] += item["hours"]
    for item in plan.get("backlog", []):
        entry = flat.setdefault(item["skill_id"], {
            "skill": item["skill"], "action": item["action"], "first_week": None,
            "hours": 0, "detail": item["detail"],
        })
        entry["hours"] += item["hours"]
    return flat


def diff_plans(old: dict, new: dict) -> dict:
    """Substantive changes (action, hours, detail) are separated from knock-on schedule shifts."""
    before, after = _flatten(old), _flatten(new)
    added = [{"skill_id": k, **after[k]} for k in after if k not in before]
    removed = [{"skill_id": k, **before[k]} for k in before if k not in after]
    changed, rescheduled = [], []
    for k in sorted(before.keys() & after.keys()):
        fields = {
            f: {"before": before[k][f], "after": after[k][f]}
            for f in ("action", "hours", "detail", "first_week")
            if before[k][f] != after[k][f]
        }
        if set(fields) - {"first_week"}:
            changed.append({"skill_id": k, "skill": after[k]["skill"], "fields": fields})
        elif fields:
            rescheduled.append({"skill_id": k, "skill": after[k]["skill"], **fields["first_week"]})
    return {
        "added": added,
        "removed": removed,
        "changed": changed,
        "rescheduled": rescheduled,
        "is_empty": not (added or removed or changed or rescheduled),
    }


def active_plan(conn) -> dict | None:
    row = db.one(conn, "SELECT * FROM plan_versions WHERE status = 'active' ORDER BY version DESC LIMIT 1")
    return _decode(row)


def pending_proposal(conn) -> dict | None:
    row = db.one(conn, "SELECT * FROM plan_versions WHERE status = 'proposed' ORDER BY version DESC LIMIT 1")
    return _decode(row)


def _decode(row: dict | None) -> dict | None:
    if not row:
        return None
    return {
        **row,
        "plan": db.loads(row["plan"], {}),
        "diff": db.loads(row["diff"], None),
        "cited_events": db.loads(row["cited_events"], []),
    }


def _next_version(conn) -> int:
    return (conn.execute("SELECT MAX(version) FROM plan_versions").fetchone()[0] or 0) + 1


def create_initial_plan(conn, plan: dict) -> int:
    version = _next_version(conn)
    conn.execute(
        """INSERT INTO plan_versions (version, base_version, status, plan, diff, reason, cited_events, trigger, created_at, decided_at)
           VALUES (?, NULL, 'active', ?, NULL, ?, '[]', 'intake', ?, ?)""",
        (version, db.dumps(plan), "Initial plan computed from the evidence ledger at intake.", db.now(), db.now()),
    )
    return version


def store_proposal(conn, plan: dict, diff: dict, reason: str, cited: list[int], trigger: str) -> dict:
    base = active_plan(conn)
    conn.execute("UPDATE plan_versions SET status = 'superseded', decided_at = ? WHERE status = 'proposed'", (db.now(),))
    version = _next_version(conn)
    conn.execute(
        """INSERT INTO plan_versions (version, base_version, status, plan, diff, reason, cited_events, trigger, created_at)
           VALUES (?, ?, 'proposed', ?, ?, ?, ?, ?, ?)""",
        (version, base["version"] if base else None, db.dumps(plan), db.dumps(diff), reason, db.dumps(cited), trigger, db.now()),
    )
    return pending_proposal(conn)


class StaleProposal(Exception):
    pass


def decide_proposal(conn, proposal_id: int, accept: bool) -> dict:
    proposal = _decode(db.one(conn, "SELECT * FROM plan_versions WHERE id = ? AND status = 'proposed'", (proposal_id,)))
    if not proposal:
        raise LookupError("No pending proposal with that id.")
    if not accept:
        conn.execute("UPDATE plan_versions SET status = 'rejected', decided_at = ? WHERE id = ?", (db.now(), proposal_id))
        return {"status": "rejected", "version": proposal["version"]}
    current = active_plan(conn)
    if current and proposal["base_version"] != current["version"]:
        raise StaleProposal("The active plan changed since this proposal was made.")
    conn.execute("UPDATE plan_versions SET status = 'superseded', decided_at = ? WHERE status = 'active'", (db.now(),))
    conn.execute("UPDATE plan_versions SET status = 'active', decided_at = ? WHERE id = ?", (db.now(), proposal_id))
    return {"status": "active", "version": proposal["version"]}
