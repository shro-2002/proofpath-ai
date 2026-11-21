"""LLM access. One interface, two engines:

- AnthropicEngine: Claude via the official SDK (structured outputs + a manual tool loop).
- OfflineEngine (app/offline_engine.py): deterministic heuristics, opt-in, always labelled in the UI.

Failures raise typed errors so the API can report them honestly instead of faking results.
"""

import json
import logging
import os
from dataclasses import dataclass
from typing import Callable, Protocol, TypeVar

import anthropic
from pydantic import BaseModel

log = logging.getLogger("proofpath.llm")

T = TypeVar("T", bound=BaseModel)

DEFAULT_MODEL = "claude-opus-5-5"
DEFAULT_BASE_URL = "https://api.anthropic.com"
STRUCTURED_MAX_TOKENS = 16000
AGENT_MAX_TOKENS = 8000


class LLMUnavailable(Exception):
    """No usable LLM configuration (e.g. missing API key)."""


class LLMFailed(Exception):
    """The LLM call was made but did not produce a usable result."""


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    input_schema: dict
    handler: Callable[[dict], dict]


class Engine(Protocol):
    name: str
    label: str

    def structured(self, *, task: str, system: str, user: str, schema: type[T], effort: str = "low") -> T: ...

    def run_agent(self, *, trigger: str, system: str, user: str, tools: list[ToolSpec], max_steps: int = 6) -> str: ...


class AnthropicEngine:
    name = "anthropic"

    def __init__(self) -> None:
        self.model = os.environ.get("PROOFPATH_MODEL", DEFAULT_MODEL)
        self.label = f"Claude ({self.model})"
        self.api_key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
        self.use_fallbacks = os.environ.get("PROOFPATH_FALLBACKS", "1") == "1"
        self._client = None

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def _get_client(self) -> anthropic.Anthropic:
        if not self.api_key:
            raise LLMUnavailable("ANTHROPIC_API_KEY is not set. Add it to .env and restart the server.")
        if self._client is None:
            # Explicit base URL so a proxy variable in the shell never silently reroutes traffic.
            base_url = os.environ.get("PROOFPATH_ANTHROPIC_BASE_URL", DEFAULT_BASE_URL)
            self._client = anthropic.Anthropic(api_key=self.api_key, base_url=base_url, timeout=120.0, max_retries=2)
        return self._client

    def _extra(self) -> dict:
        if not self.use_fallbacks:
            return {}
        return {
            "extra_headers": {"anthropic-beta": "server-side-fallback-2026-07-01"},
            "extra_body": {"fallbacks": "default"},
        }

    def _call(self, fn, task: str):
        try:
            return fn()
        except anthropic.AuthenticationError as exc:
            raise LLMUnavailable("Anthropic rejected the API key.") from exc
        except anthropic.RateLimitError as exc:
            raise LLMFailed(f"{task}: rate limited by Anthropic; retry in a moment.") from exc
        except anthropic.APIStatusError as exc:
            raise LLMFailed(f"{task}: Anthropic API error {exc.status_code}.") from exc
        except anthropic.APIConnectionError as exc:
            raise LLMFailed(f"{task}: could not reach the Anthropic API.") from exc

    def structured(self, *, task: str, system: str, user: str, schema: type[T], effort: str = "low") -> T:
        client = self._get_client()
        response = self._call(lambda: client.messages.parse(
            model=self.model,
            max_tokens=STRUCTURED_MAX_TOKENS,
            system=system,
            messages=[{"role": "user", "content": user}],
            output_format=schema,
            output_config={"effort": effort},
            **self._extra(),
        ), task)
        if response.stop_reason == "refusal":
            raise LLMFailed(f"{task}: the model declined this request.")
        if response.stop_reason == "max_tokens":
            raise LLMFailed(f"{task}: response was cut off before completion.")
        if response.parsed_output is None:
            raise LLMFailed(f"{task}: response did not match the expected schema.")
        return response.parsed_output

    def run_agent(self, *, trigger: str, system: str, user: str, tools: list[ToolSpec], max_steps: int = 6) -> str:
        client = self._get_client()
        by_name = {t.name: t for t in tools}
        tool_defs = [
            {"name": t.name, "description": t.description, "input_schema": t.input_schema, "strict": True}
            for t in tools
        ]
        messages: list[dict] = [{"role": "user", "content": user}]
        for _ in range(max_steps):
            response = self._call(lambda: client.messages.create(
                model=self.model,
                max_tokens=AGENT_MAX_TOKENS,
                system=system,
                tools=tool_defs,
                messages=messages,
                output_config={"effort": "low"},
                **self._extra(),
            ), f"agent:{trigger}")
            if response.stop_reason == "refusal":
                raise LLMFailed(f"agent:{trigger}: the model declined this request.")
            messages.append({"role": "assistant", "content": response.content})
            calls = [b for b in response.content if b.type == "tool_use"]
            if not calls:
                return " ".join(b.text for b in response.content if b.type == "text").strip()
            results = []
            for call in calls:
                spec = by_name.get(call.name)
                payload = spec.handler(dict(call.input)) if spec else {"error": f"unknown tool {call.name}"}
                results.append({
                    "type": "tool_result",
                    "tool_use_id": call.id,
                    "content": json.dumps(payload, default=str),
                    "is_error": "error" in payload,
                })
            messages.append({"role": "user", "content": results})
        return "Agent stopped after reaching its step limit."


_engine: Engine | None = None


def get_engine() -> Engine:
    global _engine
    if _engine is None:
        mode = os.environ.get("PROOFPATH_LLM", "anthropic")
        if mode == "offline":
            from app.offline_engine import OfflineEngine

            _engine = OfflineEngine()
        else:
            _engine = AnthropicEngine()
    return _engine


def set_engine(engine: Engine | None) -> None:
    """Test hook: inject a fake engine (or reset)."""
    global _engine
    _engine = engine


def engine_status() -> dict:
    engine = get_engine()
    configured = getattr(engine, "configured", True)
    return {
        "engine": engine.name,
        "label": engine.label,
        "configured": configured,
        "is_ai": engine.name == "anthropic",
    }
