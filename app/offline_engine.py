"""Offline heuristic engine (PROOFPATH_LLM=offline).

Not AI. Keyword and structure heuristics that produce the same schemas, so the product can be exercised
without an API key. The UI labels this mode clearly. All outputs still pass through the same grounding
checks as the real model.
"""

import re

from app.grounding import normalize_text, skill_tokens
from app.llm import ToolSpec
from app.schemas import (
    ArtifactCriterionReview, ArtifactReview, Canonicalization, CriterionJudgment, ExtractedClaim,
    ExtractedRequirement, GeneratedQuestion, GradeResult, JDExtraction, ProjectSuggestion,
    ProjectSuggestions, ResumeExtraction, SkillMapping,
)

SKILL_PATTERNS = {
    "Python": r"\bpython\b", "SQL": r"\bsql\b", "Statistics": r"\bstatistic", "A/B testing": r"\ba/b test|experiment",
    "Machine learning": r"machine learning|\bml\b models?", "Deep learning": r"deep learning|pytorch|tensorflow",
    "pandas": r"\bpandas\b", "scikit-learn": r"scikit-learn|sklearn", "Docker": r"\bdocker\b",
    "Cloud platforms": r"\baws\b|\bgcp\b|azure|cloud", "dbt": r"\bdbt\b", "Data modeling": r"data model",
    "Airflow": r"airflow|orchestrat", "Tableau": r"tableau|looker|power bi", "Git": r"\bgit\b|version control",
    "Model deployment": r"deploy|production model|serving", "Feature engineering": r"feature engineering",
    "Stakeholder communication": r"stakeholder|communicat", "Excel": r"\bexcel\b", "Spark": r"\bspark\b",
    "MLOps": r"mlops|monitoring", "Causal inference": r"causal",
}
NICE = re.compile(r"prefer|plus|nice to have|bonus|ideally", re.I)


def _sentences(text: str) -> list[str]:
    parts = []
    for line in text.splitlines():
        parts += [s.strip(" -•*\t") for s in re.split(r"(?<=[.!?])\s+", line) if s.strip()]
    return [p for p in parts if 12 <= len(p) <= 380]


def _between(user: str, tag: str) -> str:
    m = re.search(rf"<{tag}>\n?(.*?)\n?</{tag}>", user, re.S)
    return m.group(1) if m else ""


class OfflineEngine:
    name = "offline"
    label = "Offline heuristics (no AI)"
    configured = True

    def structured(self, *, task, system, user, schema, effort="low"):
        handler = {
            JDExtraction: self._jd, Canonicalization: self._canon, ResumeExtraction: self._resume,
            GeneratedQuestion: self._question, GradeResult: self._grade, ProjectSuggestions: self._projects,
            ArtifactReview: self._artifact,
        }[schema]
        return handler(user)

    def _jd(self, user):
        reqs, seen = [], set()
        for sentence in _sentences(_between(user, "job_description")):
            for skill, pattern in SKILL_PATTERNS.items():
                if skill not in seen and re.search(pattern, sentence, re.I):
                    seen.add(skill)
                    reqs.append(ExtractedRequirement(skill=skill, importance="nice" if NICE.search(sentence) else "must", quote=sentence))
        return JDExtraction(requirements=reqs)

    def _canon(self, user):
        names = [l[2:] for l in user.splitlines() if l.startswith("- ")]
        return Canonicalization(mappings=[SkillMapping(name=n, canonical=n) for n in names])

    def _resume(self, user):
        skills = [l[2:] for l in user.split("<resume>")[0].splitlines() if l.startswith("- ")]
        sentences = _sentences(_between(user, "resume"))
        claims = []
        for skill in skills:
            pattern = SKILL_PATTERNS.get(skill)
            for s in sentences:
                if (pattern and re.search(pattern, s, re.I)) or skill_tokens(skill) & set(normalize_text(s).split()):
                    claims.append(ExtractedClaim(skill=skill, quote=s))
                    break
        return ResumeExtraction(claims=claims)

    def _question(self, user):
        skill = re.search(r"Skill: (.+)", user).group(1)
        role = re.search(r"Target role: (.+)", user).group(1)
        return GeneratedQuestion(
            question=(f"As a {role}, walk through how you would use {skill} on a real problem: the concrete steps, "
                      "the decisions you would make, and one trade-off or failure mode you would watch for."),
            key_points=[f"Accurate description of how {skill} works", "A concrete scenario with specific steps or numbers",
                        "At least one trade-off, limitation or failure mode", "Correct use of domain terms"],
        )

    def _grade(self, user):
        answer = _between(user, "candidate_answer")
        sentences = [s for s in re.split(r"(?<=[.!?])\s+", answer) if len(s.split()) >= 6]
        words = len(answer.split())

        def find(pattern):
            return next((s for s in sentences if re.search(pattern, s, re.I)), "")

        def judge(name, quote, strong):
            rating = "met" if quote and strong else ("partial" if quote else "not_met")
            return CriterionJudgment(criterion=name, rating=rating, evidence_quote=quote if rating != "not_met" else "",
                                     feedback="Heuristic check (offline mode).")

        first = sentences[0] if sentences else ""
        return GradeResult(criteria=[
            judge("correctness", first, words >= 80 and len(sentences) >= 4),
            judge("depth", find(r"because|trade-?off|however|risk|limitation|downside"), len(sentences) >= 4),
            judge("application", find(r"\d|for example|e\.g\.|for instance|scenario"), words >= 60),
            judge("precision", sentences[1] if len(sentences) > 2 else "", len(sentences) >= 5),
        ], overall_feedback="Graded by offline heuristics, not an AI model.")

    def _projects(self, user):
        gaps = re.findall(r"- ([a-z0-9+#-]+): (.+?) \(", user)
        projects = []
        for i in range(0, min(len(gaps), 6), 2):
            pair = gaps[i:i + 2]
            names = " + ".join(n for _, n in pair)
            projects.append(ProjectSuggestion(
                title=f"Applied project: {names}", brief=f"A small end-to-end project that exercises {names} on a public dataset.",
                skill_ids=[sid for sid, _ in pair],
                acceptance_criteria=["README states the problem and dataset", "Results reported on a held-out set with a metric",
                                     "README lists one limitation and a next step"],
            ))
        return ProjectSuggestions(projects=projects)

    def _artifact(self, user):
        criteria = [l[2:] for l in user.split("<submission>")[0].splitlines() if l.startswith("- ")]
        sentences = _sentences(_between(user, "submission"))
        reviews = []
        for c in criteria:
            tokens = {w for w in normalize_text(c).split() if len(w) > 3}
            hit = next((s for s in sentences if len(tokens & set(normalize_text(s).split())) >= 2), "")
            reviews.append(ArtifactCriterionReview(criterion=c, met=bool(hit), evidence_quote=hit, note="Heuristic match (offline mode)."))
        return ArtifactReview(criteria=reviews, summary="Reviewed by offline heuristics, not an AI model.")

    def run_agent(self, *, trigger: str, system: str, user: str, tools: list[ToolSpec], max_steps: int = 6) -> str:
        t = {spec.name: spec.handler for spec in tools}
        if trigger == "select_probe":
            skills = t["get_ledger_summary"]({})["skills"]
            open_ = [s for s in skills if s["uncertainty"] in ("unknown", "high", "conflicting") and s["level"] != "artifact_backed"]
            pick = (open_ or skills)[0]
            t["select_assessment_target"]({"skill_id": pick["skill_id"], "reason": f"Highest priority skill with {pick['uncertainty']} evidence ({pick['demand']})."})
            return f"Selected {pick['skill_id']} for assessment."
        if trigger == "after_application" and not t["get_application_insights"]({})["signal"]:
            return "Not enough application outcomes to justify any change."
        if t["preview_plan_change"]({})["diff"]["is_empty"]:
            return "New evidence did not change the computed plan; no proposal."
        if trigger == "after_application":
            t["propose_plan_change"]({"reason": "Response rates by role type now separate beyond their uncertainty, so priorities shifted modestly.", "cited_event_ids": []})
            return "Proposed a plan update for confirmation."
        match = re.search(r"event ids?:? \[?([\d, ]+)\]?", user)
        ids = [int(i) for i in re.findall(r"\d+", match.group(1))] if match else []
        if not ids:
            return "Plan differs but no evidence event to cite; no proposal."
        t["propose_plan_change"]({"reason": f"New evidence (event {', '.join(map(str, ids))}) changed this skill's level, so the computed plan changed.", "cited_event_ids": ids})
        return "Proposed a plan update for confirmation."
