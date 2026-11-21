"""Pydantic models: LLM structured outputs and API request bodies."""

from typing import Literal

from pydantic import BaseModel, Field, HttpUrl

Criterion = Literal["correctness", "depth", "application", "precision"]
Rating = Literal["met", "partial", "not_met"]

RUBRIC = {
    "correctness": "The core technical claims are accurate for the question asked.",
    "depth": "Explains why, including at least one trade-off, limitation or failure mode.",
    "application": "Applies the idea to a concrete scenario with specific steps or numbers.",
    "precision": "Uses domain terms correctly and in relation to each other, not as a list.",
}


# ---- LLM outputs -----------------------------------------------------------

class ExtractedRequirement(BaseModel):
    skill: str = Field(description="Short canonical skill name, e.g. 'SQL', 'A/B testing', 'Docker'.")
    importance: Literal["must", "nice"]
    quote: str = Field(description="Exact sentence or phrase copied verbatim from the job description.")


class JDExtraction(BaseModel):
    requirements: list[ExtractedRequirement]


class SkillMapping(BaseModel):
    name: str
    canonical: str


class Canonicalization(BaseModel):
    mappings: list[SkillMapping]


class ExtractedClaim(BaseModel):
    skill: str = Field(description="Must be one of the provided skill names, copied exactly.")
    quote: str = Field(description="Exact passage copied verbatim from the resume.")


class ResumeExtraction(BaseModel):
    claims: list[ExtractedClaim]


class GeneratedQuestion(BaseModel):
    question: str
    key_points: list[str] = Field(description="3-4 points a strong answer must cover; fixed before the answer is seen.")


class CriterionJudgment(BaseModel):
    criterion: Criterion
    rating: Rating
    evidence_quote: str = Field(description="Exact span copied from the candidate answer supporting the rating; empty if not_met.")
    feedback: str


class GradeResult(BaseModel):
    criteria: list[CriterionJudgment]
    overall_feedback: str


class ProjectSuggestion(BaseModel):
    title: str
    brief: str
    skill_ids: list[str]
    acceptance_criteria: list[str]


class ProjectSuggestions(BaseModel):
    projects: list[ProjectSuggestion]


class ArtifactCriterionReview(BaseModel):
    criterion: str
    met: bool
    evidence_quote: str = Field(description="Exact span copied from the submitted text; empty if not met.")
    note: str


class ArtifactReview(BaseModel):
    criteria: list[ArtifactCriterionReview]
    summary: str


# ---- API requests ----------------------------------------------------------

class JDInput(BaseModel):
    title: str = Field(min_length=2, max_length=120)
    company: str = Field(min_length=1, max_length=120)
    role_family: str = Field(min_length=2, max_length=60)
    text: str = Field(min_length=200, max_length=20000)


class IntakeRequest(BaseModel):
    resume_text: str = Field(min_length=200, max_length=20000)
    target_role: str = Field(min_length=2, max_length=120)
    current_role: str | None = Field(default=None, max_length=120)
    hours_per_week: int = Field(ge=2, le=40)
    jds: list[JDInput] = Field(min_length=1, max_length=6)


class StartAssessmentRequest(BaseModel):
    skill_id: str = Field(min_length=1, max_length=80)


class AnswerRequest(BaseModel):
    answer: str = Field(min_length=1, max_length=6000)


class ArtifactRequest(BaseModel):
    url: HttpUrl
    submitted_text: str = Field(default="", max_length=12000)


class ApplicationCreate(BaseModel):
    company: str = Field(min_length=1, max_length=120)
    role_title: str = Field(min_length=2, max_length=120)
    role_family: str = Field(min_length=2, max_length=60)
    status: Literal["applied", "no_response", "rejected", "interview", "offer"] = "applied"


class ApplicationUpdate(BaseModel):
    status: Literal["applied", "no_response", "rejected", "interview", "offer"]
