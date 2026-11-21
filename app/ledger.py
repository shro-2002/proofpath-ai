"""Evidence ledger: deterministic state per skill.

Evidence strength is never 1.0. The ledger describes what has been shown, not readiness.
"""

from dataclasses import dataclass, field

from app import db

LEVELS = ("none", "claimed", "partial", "demonstrated", "artifact_backed")
STRENGTH = {
    "none": 0.0,
    "claimed": 0.25,
    "partial": 0.45,
    "demonstrated": 0.65,
    "artifact_backed": 0.85,
}
CONTESTED_STRENGTH = 0.10
ARTIFACT_WITH_RECENT_FAIL_STRENGTH = 0.80

LEVEL_LABELS = {
    "none": "No evidence",
    "claimed": "Claimed on resume",
    "partial": "Partially demonstrated",
    "demonstrated": "Demonstrated in assessment",
    "artifact_backed": "Backed by reviewed artifact",
}


@dataclass(frozen=True)
class SkillState:
    level: str
    strength: float
    uncertainty: str
    contested: bool
    reasons: tuple[str, ...] = field(default_factory=tuple)


def compute_state(claim_count: int, outcomes: list[str], artifact_statuses: list[str]) -> SkillState:
    """outcomes: graded assessment outcomes oldest-first ('pass' | 'partial' | 'fail')."""
    has_claim = claim_count > 0
    latest = outcomes[-1] if outcomes else None
    passes = outcomes.count("pass")
    artifact_pass = "passed" in artifact_statuses
    reasons: list[str] = []

    if artifact_pass:
        level = "artifact_backed"
        reasons.append("A pasted project excerpt passed review against its acceptance criteria. The linked repository itself was not inspected.")
    elif latest == "pass":
        level = "demonstrated"
        reasons.append("Most recent assessment passed the rubric.")
    elif latest == "partial" or (latest == "fail" and passes > 0):
        level = "partial"
        reasons.append("Assessment evidence is partial or mixed.")
    elif has_claim:
        level = "claimed"
        reasons.append("Resume mentions it; not yet demonstrated.")
    else:
        level = "none"
        reasons.append("No resume claim, assessment, or artifact yet.")

    contested = latest == "fail" and has_claim and not artifact_pass and passes == 0
    strength = STRENGTH[level]
    if contested:
        strength = CONTESTED_STRENGTH
        reasons.append("Latest assessment failed, which contests the resume claim.")
    if artifact_pass and latest == "fail":
        strength = ARTIFACT_WITH_RECENT_FAIL_STRENGTH
        reasons.append("A recent weak answer is noted but does not erase reviewed artifact evidence.")
    if "unreviewed" in artifact_statuses:
        reasons.append("An artifact is linked but unreviewed; it does not count yet.")

    return SkillState(level, strength, _uncertainty(level, outcomes, has_claim, artifact_pass), contested, tuple(reasons))


def _uncertainty(level: str, outcomes: list[str], has_claim: bool, artifact_pass: bool) -> str:
    latest = outcomes[-1] if outcomes else None
    if not outcomes and level == "none":
        return "unknown"
    if not outcomes and level == "claimed":
        return "high"
    mixed = "pass" in outcomes and "fail" in outcomes
    if mixed or (latest == "fail" and (has_claim or artifact_pass)):
        return "conflicting"
    if artifact_pass or (len(outcomes) >= 2 and len(set(outcomes[-2:])) == 1):
        return "low"
    return "medium"


def skill_state(conn, skill_id: str) -> SkillState:
    claim_count = conn.execute("SELECT COUNT(*) FROM claims WHERE skill_id = ?", (skill_id,)).fetchone()[0]
    outcomes = [r["outcome"] for r in db.rows(
        conn,
        "SELECT outcome FROM assessments WHERE skill_id = ? AND status = 'graded' ORDER BY answered_at, id",
        (skill_id,),
    )]
    statuses = [
        a["review_status"]
        for a in db.rows(conn, "SELECT skill_ids, review_status FROM artifacts")
        if skill_id in db.loads(a["skill_ids"], [])
    ]
    return compute_state(claim_count, outcomes, statuses)


def record_event(conn, skill_id: str, kind: str, source_ref: str, before: SkillState, note: str) -> int | None:
    """Append an evidence event. Returns None if this source already produced an event (idempotent)."""
    after = skill_state(conn, skill_id)
    cur = conn.execute(
        """INSERT OR IGNORE INTO evidence_events
           (skill_id, kind, source_ref, before_level, after_level, before_strength, after_strength, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (skill_id, kind, source_ref, before.level, after.level, before.strength, after.strength, note, db.now()),
    )
    return cur.lastrowid if cur.rowcount else None


def demand_by_skill(conn) -> dict[str, dict]:
    """Demand across JDs: how many postings ask for it, and how strongly."""
    jd_count = conn.execute("SELECT COUNT(*) FROM job_descriptions").fetchone()[0] or 1
    demand: dict[str, dict] = {}
    for r in db.rows(conn, "SELECT skill_id, jd_id, importance FROM requirements"):
        entry = demand.setdefault(r["skill_id"], {"jd_ids": set(), "must": 0, "weighted": 0.0})
        entry["jd_ids"].add(r["jd_id"])
        entry["must"] += r["importance"] == "must"
        entry["weighted"] += 1.0 if r["importance"] == "must" else 0.5
    return {
        sid: {
            "jd_count": len(e["jd_ids"]),
            "jd_total": jd_count,
            "must_count": e["must"],
            "frequency": round(len(e["jd_ids"]) / jd_count, 3),
            "weighted_demand": round(e["weighted"] / jd_count, 3),
        }
        for sid, e in demand.items()
    }


def ledger_rows(conn, response_weights: dict[str, float] | None = None) -> list[dict]:
    """One row per skill with state, demand and deterministic priority."""
    weights = response_weights or {}
    demand = demand_by_skill(conn)
    out = []
    for s in db.rows(conn, "SELECT id, name FROM skills ORDER BY name"):
        state = skill_state(conn, s["id"])
        d = demand.get(s["id"], {"jd_count": 0, "jd_total": 0, "must_count": 0, "frequency": 0.0, "weighted_demand": 0.0})
        weight = weights.get(s["id"], 1.0)
        priority = round(d["weighted_demand"] * (1 - state.strength) * weight, 4)
        last = db.one(
            conn,
            "SELECT outcome, criteria FROM assessments WHERE skill_id = ? AND status = 'graded' ORDER BY answered_at DESC, id DESC LIMIT 1",
            (s["id"],),
        )
        failed =[c["criterion"] for c in db.loads(last["criteria"], []) if c["rating"] != "met"] if last else []
        out.append({
            "skill_id": s["id"],
            "name": s["name"],
            "level": state.level,
            "level_label": LEVEL_LABELS[state.level],
            "strength": state.strength,
            "uncertainty": state.uncertainty,
            "contested": state.contested,
            "reasons": list(state.reasons),
            "demand": d,
            "response_weight": weight,
            "priority": priority,
            "last_outcome": last["outcome"] if last else None,
            "weak_criteria": failed,
        })
    return sorted(out, key=lambda r: (-r["priority"], r["skill_id"]))
