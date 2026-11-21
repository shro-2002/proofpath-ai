"""The core loop: assessment -> evidence event -> agent proposal -> user decision -> new plan version."""

from app.schemas import CriterionJudgment, GradeResult

GOOD_ANSWER = (
    "I would size the test from the baseline conversion of 4% and a minimum detectable effect of 0.4 points, "
    "because smaller lifts would not justify the pricing change. With alpha 0.05 and 80% power that needs roughly "
    "39,000 users per arm. I would randomise by user, not session, to avoid contamination. "
    "The trade-off is duration: two weeks captures weekly seasonality but delays the decision. "
    "I would also check sample ratio mismatch before reading the result."
)


def _grade_from_answer(user):
    answer = user.split("<candidate_answer>")[1].split("</candidate_answer>")[0].strip()
    sentences = [s.strip() for s in answer.split(". ") if s.strip()]
    return GradeResult(
        criteria=[CriterionJudgment(criterion=c, rating="met", evidence_quote=sentences[i], feedback="Specific.")
                  for i, c in enumerate(("correctness", "depth", "application", "precision"))],
        overall_feedback="Strong, specific answer.",
    )


def test_assessment_pass_produces_justified_proposal_and_new_version(onboarded, engine):
    engine.overrides[GradeResult] = _grade_from_answer
    before = onboarded.get("/api/skills/ab-testing").json()
    assert before["level"] == "claimed"
    aid = onboarded.post("/api/assessments", json={"skill_id": "ab-testing"}).json()["id"]
    result = onboarded.post(f"/api/assessments/{aid}/answer", json={"answer": GOOD_ANSWER}).json()

    assert result["assessment"]["outcome"] == "pass"
    proposal = result["proposal"]
    assert proposal and proposal["status"] == "proposed"
    assert result["event_id"] in proposal["cited_events"]
    touched = {c["skill_id"] for c in proposal["diff"]["changed"]} | {r["skill_id"] for r in proposal["diff"]["removed"]}
    assert "ab-testing" in touched

    plan = onboarded.get("/api/plan").json()
    assert plan["active"]["version"] == 1  # nothing committed without confirmation
    accepted = onboarded.post(f"/api/plan/proposals/{proposal['id']}/accept").json()
    assert accepted == {"status": "active", "version": proposal["version"]}
    assert onboarded.get("/api/plan").json()["active"]["version"] == proposal["version"]
    assert onboarded.get("/api/skills/ab-testing").json()["level"] == "demonstrated"


def test_agent_cannot_propose_without_a_plan_change(onboarded, engine):
    attempts = []

    def policy(trigger, user, tools):
        attempts.append(tools["propose_plan_change"]({"reason": "Evidence suggests a change here.", "cited_event_ids": [1]}))
        return "tried"

    engine.agent_policy = policy
    from app.agent import run_agent

    run_agent("after_assessment", "No new evidence since intake.")
    assert attempts and "error" in attempts[-1]
    assert onboarded.get("/api/plan").json()["proposal"] is None


def test_agent_reason_cannot_claim_job_readiness(onboarded, engine):
    engine.overrides[GradeResult] = _grade_from_answer
    results = []

    def policy(trigger, user, tools):
        if trigger == "after_assessment":
            results.append(tools["propose_plan_change"]({"reason": "You are now job-ready for this role.", "cited_event_ids": [1]}))
        return "done"

    engine.agent_policy = policy
    aid = onboarded.post("/api/assessments", json={"skill_id": "ab-testing"}).json()["id"]
    onboarded.post(f"/api/assessments/{aid}/answer", json={"answer": GOOD_ANSWER})
    assert results and "error" in results[0]
    assert onboarded.get("/api/plan").json()["proposal"] is None
