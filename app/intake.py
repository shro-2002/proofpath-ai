"""Intake: resume + several JDs -> grounded requirements and claims -> ledger -> plan v1.

All LLM calls happen before the database is touched, so a failed call never wipes a workspace.
"""

from concurrent.futures import ThreadPoolExecutor

from app import db, grounding, ledger, planner, prompts
from app.agent_log import log_entry
from app.llm import LLMFailed, get_engine
from app.schemas import Canonicalization, IntakeRequest, JDExtraction, ResumeExtraction

MAX_PARALLEL_EXTRACTIONS = 4


def _extract_jds(engine, req: IntakeRequest) -> list[JDExtraction]:
    def extract(jd):
        return engine.structured(
            task=f"Extract requirements from '{jd.title}'",
            system=prompts.JD_EXTRACTION,
            user=f"Role: {jd.title} at {jd.company}\n<job_description>\n{jd.text}\n</job_description>",
            schema=JDExtraction,
        )

    with ThreadPoolExecutor(max_workers=MAX_PARALLEL_EXTRACTIONS) as pool:
        return list(pool.map(extract, req.jds))


def _canonicalize(engine, names: list[str]) -> dict[str, str]:
    if len(names) < 2:
        return {n: n for n in names}
    result = engine.structured(
        task="Merge equivalent skill names",
        system=prompts.CANONICALIZE,
        user="Skill names:\n" + "\n".join(f"- {n}" for n in names),
        schema=Canonicalization,
    )
    mapping = {m.name: m.canonical.strip() for m in result.mappings if m.name in names and m.canonical.strip()}
    return {n: mapping.get(n, n) for n in names}  # unmapped names keep their own identity


def _verified_requirements(req: IntakeRequest, extractions: list[JDExtraction]):
    kept, rejected = [], []
    for index, (jd, extraction) in enumerate(zip(req.jds, extractions)):
        for item in extraction.requirements:
            ok, reason = grounding.verify_quote(item.quote, jd.text)
            if ok:
                kept.append((index, item.skill.strip(), item.importance, item.quote.strip()))
            else:
                rejected.append((f"jd:{jd.title}", item.skill, item.quote, reason))
    return kept, rejected


def _verified_claims(req: IntakeRequest, extraction: ResumeExtraction, allowed: dict[str, str]):
    """allowed: lowercase canonical name -> canonical name."""
    kept, rejected = [], []
    for claim in extraction.claims:
        canonical = allowed.get(claim.skill.strip().lower())
        if not canonical:
            rejected.append(("resume", claim.skill, claim.quote, "skill not in the job-description skill list"))
            continue
        ok, reason = grounding.verify_quote(claim.quote, req.resume_text)
        if ok:
            kept.append((canonical, claim.quote.strip(), grounding.claim_match(canonical, claim.quote)))
        else:
            rejected.append(("resume", claim.skill, claim.quote, reason))
    return kept, rejected


def run_intake(req: IntakeRequest) -> dict:
    engine = get_engine()
    extractions = _extract_jds(engine, req)
    requirements, rejected = _verified_requirements(req, extractions)
    if not requirements:
        raise LLMFailed("No requirement could be grounded in the job-description text. Nothing was saved.")

    mapping = _canonicalize(engine, sorted({r[1] for r in requirements}))
    canonical_names = sorted(set(mapping.values()))
    resume_extraction = engine.structured(
        task="Find resume evidence",
        system=prompts.RESUME_EXTRACTION,
        user="Skills:\n" + "\n".join(f"- {n}" for n in canonical_names) + f"\n<resume>\n{req.resume_text}\n</resume>",
        schema=ResumeExtraction,
    )
    claims, claim_rejects = _verified_claims(req, resume_extraction, {n.lower(): n for n in canonical_names})
    rejected += claim_rejects

    with db.connect() as conn:
        db.reset_workspace(conn)
        _persist(conn, req, requirements, mapping, claims, rejected)
        state = ledger.ledger_rows(conn)
        version = planner.create_initial_plan(conn, planner.build_plan(state, req.hours_per_week))
        log_entry(conn, "intake", "intake", "system", "intake_completed", {
            "job_descriptions": len(req.jds),
            "skills": len(canonical_names),
            "grounded_requirements": len(requirements),
            "grounded_claims": len(claims),
            "rejected_items": len(rejected),
            "plan_version": version,
        })
    return {
        "skills": len(canonical_names),
        "requirements": len(requirements),
        "claims": len(claims),
        "rejected": len(rejected),
        "plan_version": version,
    }


def _persist(conn, req, requirements, mapping, claims, rejected) -> None:
    ts = db.now()
    conn.execute(
        "INSERT INTO profile (id, resume_text, target_role, hours_per_week, created_at) VALUES (1, ?, ?, ?, ?)",
        (req.resume_text, req.target_role, req.hours_per_week, ts),
    )
    jd_ids = []
    for jd in req.jds:
        cur = conn.execute(
            "INSERT INTO job_descriptions (title, company, role_family, text, created_at) VALUES (?, ?, ?, ?, ?)",
            (jd.title, jd.company, jd.role_family.strip(), jd.text, ts),
        )
        jd_ids.append(cur.lastrowid)

    for name in sorted(set(mapping.values())):
        conn.execute("INSERT OR IGNORE INTO skills (id, name) VALUES (?, ?)", (grounding.skill_id(name), name))

    for index, raw_name, importance, quote in requirements:
        sid = grounding.skill_id(mapping[raw_name])
        existing = db.one(conn, "SELECT importance FROM requirements WHERE jd_id = ? AND skill_id = ?", (jd_ids[index], sid))
        if existing is None:
            conn.execute(
                "INSERT INTO requirements (jd_id, skill_id, quote, importance) VALUES (?, ?, ?, ?)",
                (jd_ids[index], sid, quote, importance),
            )
        elif existing["importance"] == "nice" and importance == "must":
            conn.execute(
                "UPDATE requirements SET importance = 'must', quote = ? WHERE jd_id = ? AND skill_id = ?",
                (quote, jd_ids[index], sid),
            )

    for canonical, quote, match in claims:
        sid = grounding.skill_id(canonical)
        before = ledger.skill_state(conn, sid)
        cur = conn.execute("INSERT OR IGNORE INTO claims (skill_id, quote, match) VALUES (?, ?, ?)", (sid, quote, match))
        if cur.rowcount:
            ledger.record_event(conn, sid, "resume_claim", f"claim:{cur.lastrowid}", before,
                                f"Resume quote verified against resume text ({match} match).")

    for source, skill_name, quote, reason in rejected:
        conn.execute(
            "INSERT INTO rejected_items (source, skill_name, quote, reason, created_at) VALUES (?, ?, ?, ?, ?)",
            (source, skill_name, quote[:500], reason, ts),
        )
