"""Application tracker statistics. Cautious by construction: no pattern claims on thin data."""

import math

from app import db

MIN_OUTCOMES_TOTAL = 8
MIN_OUTCOMES_PER_FAMILY = 4
Z_95 = 1.96
BOOST = 1.2
DAMPEN = 0.85
RESPONDED = ("interview", "offer")
OUTCOMES = ("interview", "offer", "rejected", "no_response")


def wilson(successes: int, n: int) -> tuple[float, float]:
    if n == 0:
        return 0.0, 1.0
    p = successes / n
    denom = 1 + Z_95**2 / n
    centre = (p + Z_95**2 / (2 * n)) / denom
    margin = Z_95 * math.sqrt(p * (1 - p) / n + Z_95**2 / (4 * n**2)) / denom
    return round(max(0.0, centre - margin), 3), round(min(1.0, centre + margin), 3)


def family_stats(conn) -> list[dict]:
    stats: dict[str, dict] = {}
    for a in db.rows(conn, "SELECT role_family, status FROM applications"):
        fam = stats.setdefault(a["role_family"], {"role_family": a["role_family"], "applied": 0, "outcomes": 0, "responded": 0, "rejected": 0, "no_response": 0})
        fam["applied"] += 1
        if a["status"] in OUTCOMES:
            fam["outcomes"] += 1
        fam["responded"] += a["status"] in RESPONDED
        fam["rejected"] += a["status"] == "rejected"
        fam["no_response"] += a["status"] == "no_response"
    out = []
    for fam in stats.values():
        low, high = wilson(fam["responded"], fam["outcomes"])
        rate = round(fam["responded"] / fam["outcomes"], 3) if fam["outcomes"] else None
        out.append({**fam, "response_rate": rate, "ci_low": low, "ci_high": high})
    return sorted(out, key=lambda f: f["role_family"])


def insights(conn) -> dict:
    fams = family_stats(conn)
    total = sum(f["outcomes"] for f in fams)
    eligible = [f for f in fams if f["outcomes"] >= MIN_OUTCOMES_PER_FAMILY]
    signal = None
    if total >= MIN_OUTCOMES_TOTAL and len(eligible) >= 2:
        best = max(eligible, key=lambda f: f["ci_low"])
        worst = min(eligible, key=lambda f: f["ci_high"])
        if best is not worst and best["ci_low"] > worst["ci_high"]:
            signal = {"stronger": best["role_family"], "weaker": worst["role_family"]}
    if signal:
        message = (
            f"{signal['stronger']} roles respond more often than {signal['weaker']} roles, and the 95% "
            "intervals do not overlap. Skills those postings ask for get a modest priority adjustment."
        )
    elif total < MIN_OUTCOMES_TOTAL:
        message = (
            f"{total} outcome(s) logged. ProofPath needs at least {MIN_OUTCOMES_TOTAL} outcomes, "
            f"with {MIN_OUTCOMES_PER_FAMILY}+ per role type, before it changes anything based on responses."
        )
    else:
        message = "Response rates by role type overlap within their uncertainty. No change is justified yet."
    return {
        "families": fams,
        "total_outcomes": total,
        "signal": signal,
        "message": message,
        "thresholds": {"min_total": MIN_OUTCOMES_TOTAL, "min_per_family": MIN_OUTCOMES_PER_FAMILY},
    }


def response_weights(conn) -> dict[str, float]:
    """Priority multipliers per skill. Empty (all 1.0) unless a statistically separated signal exists."""
    signal = insights(conn)["signal"]
    if not signal:
        return {}
    weights: dict[str, float] = {}
    reqs = db.rows(conn, "SELECT r.skill_id, j.role_family FROM requirements r JOIN job_descriptions j ON j.id = r.jd_id")
    stronger = {r["skill_id"] for r in reqs if r["role_family"] == signal["stronger"]}
    weaker = {r["skill_id"] for r in reqs if r["role_family"] == signal["weaker"]}
    for sid in stronger - weaker:
        weights[sid] = BOOST
    for sid in weaker - stronger:
        weights[sid] = DAMPEN
    return weights
