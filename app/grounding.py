"""Deterministic guards: quote verification, skill IDs, injection and stuffing detection.

Nothing in this module calls an LLM. These checks run on every model output before
anything reaches the ledger.
"""

import re
import unicodedata

MIN_QUOTE_CHARS = 12
MAX_QUOTE_CHARS = 400

_CHAR_MAP = str.maketrans({
    "‘": "'", "’": "'", "“": '"', "”": '"',
    "–": "-", "—": "-", "•": " ", " ": " ",
})

SKILL_ALIASES = {
    "js": "javascript",
    "node": "nodejs",
    "node.js": "nodejs",
    "ml": "machine learning",
    "k8s": "kubernetes",
    "restful apis": "rest apis",
    "rest api": "rest apis",
    "ci/cd": "ci cd",
    "a/b testing": "ab testing",
    "a/b tests": "ab testing",
    "experimentation": "ab testing",
    "postgres": "postgresql",
    "sklearn": "scikit-learn",
    "statistics": "statistical analysis",
    "stats": "statistical analysis",
}

INJECTION_PATTERNS = [
    r"ignore (all |any )?(the )?(previous|prior|above|earlier) (instructions|rules|prompts?)",
    r"disregard (the |all |any )?(previous |prior |above )?(instructions|rules|rubric)",
    r"(give|award|assign|mark) (me |this( answer)? )?(full|maximum|max|perfect|all) (marks|points|score|credit)",
    r"\b(mark|grade|rate|score) (this|me|it) (as )?(met|pass(ed)?|correct|perfect)\b",
    r"you are now\b",
    r"\bsystem prompt\b",
    r"^\s*(system|assistant)\s*:",
    r"new instructions?\s*:",
    r"override (the )?(rubric|grading|rules)",
]
_INJECTION_RE = [re.compile(p, re.IGNORECASE | re.MULTILINE) for p in INJECTION_PATTERNS]


def normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).translate(_CHAR_MAP)
    return re.sub(r"\s+", " ", text).strip().lower()


def verify_quote(quote: str, source: str) -> tuple[bool, str]:
    """A quote is grounded only if it appears verbatim (modulo whitespace/quotes/case) in source."""
    norm_quote = normalize_text(quote).strip(" .,;:")
    if len(norm_quote) < MIN_QUOTE_CHARS:
        return False, "quote too short to be evidence"
    if len(norm_quote) > MAX_QUOTE_CHARS:
        return False, "quote too long; evidence must be a specific passage"
    if norm_quote not in normalize_text(source):
        return False, "quote not found in source text"
    return True, "verified"


def verify_evidence_quote(quote: str, source: str) -> tuple[bool, str]:
    """A quote counts as evidence only if it is grounded in the source and is not itself an instruction."""
    ok, reason = verify_quote(quote, source)
    if ok and contains_injection(quote):
        return False, "quoted text is an instruction, not evidence"
    return ok, reason


def skill_id(name: str) -> str:
    base = normalize_text(name).strip(" .")
    base = SKILL_ALIASES.get(base, base)
    slug = re.sub(r"[^a-z0-9+#]+", "-", base).strip("-")
    return slug or "unknown"


def skill_tokens(name: str) -> set[str]:
    """Distinctive tokens of a skill name, used to label a claim explicit vs inferred."""
    stop = {"and", "or", "the", "of", "for", "with", "in", "to", "a", "an", "skills", "experience"}
    norm = SKILL_ALIASES.get(normalize_text(name), normalize_text(name))
    words = set(re.findall(r"[a-z0-9+#]+", norm)) | set(re.findall(r"[a-z0-9+#]+", normalize_text(name)))
    return {w for w in words if w not in stop and len(w) > 1}


def claim_match(skill_name: str, quote: str) -> str:
    quote_words = set(re.findall(r"[a-z0-9+#]+", normalize_text(quote)))
    return "explicit" if skill_tokens(skill_name) & quote_words else "inferred"


def detect_injection(text: str) -> list[str]:
    hits = []
    for pattern in _INJECTION_RE:
        match = pattern.search(text)
        if match:
            hits.append(match.group(0).strip())
    return hits


def contains_injection(text: str) -> bool:
    return bool(detect_injection(text))


def looks_keyword_stuffed(answer: str) -> bool:
    """True when an answer is mostly a list of terms rather than reasoning.

    Heuristic: few real sentences (6+ words) relative to many short comma/newline fragments.
    """
    fragments = [f.strip() for f in re.split(r"[,;\n•|/]+", answer) if f.strip()]
    short_fragments = [f for f in fragments if len(f.split()) <= 3]
    sentences = [s for s in re.split(r"[.!?]+", answer) if len(s.split()) >= 6]
    words = answer.split()
    if len(words) < 12:
        return False  # too short to judge as stuffing; the length cap handles it
    stuffed_ratio = len(short_fragments) / max(len(fragments), 1)
    return stuffed_ratio >= 0.6 and len(short_fragments) >= 6 and len(sentences) <= 2


def word_count(text: str) -> int:
    return len(text.split())
