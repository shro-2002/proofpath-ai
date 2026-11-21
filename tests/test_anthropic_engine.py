"""Checks the request shape AnthropicEngine sends, using a mock HTTP transport (no network, no key)."""

import json

import anthropic
import httpx2 as httpx

from app.llm import AnthropicEngine, ToolSpec
from app.schemas import GeneratedQuestion


def _engine_with(handler, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    engine = AnthropicEngine()
    engine._client = anthropic.Anthropic(
        api_key="test-key", base_url="https://api.anthropic.com",
        http_client=httpx.Client(transport=httpx.MockTransport(handler)), max_retries=0,
    )
    return engine


def _message(content, stop_reason="end_turn"):
    return {
        "id": "msg_1", "type": "message", "role": "assistant", "model": "claude-opus-5-5",
        "content": content, "stop_reason": stop_reason, "stop_sequence": None,
        "usage": {"input_tokens": 10, "output_tokens": 10},
    }


def test_structured_call_sends_schema_effort_and_fallback(monkeypatch):
    seen = {}

    def handler(request):
        seen["body"] = json.loads(request.content)
        seen["beta"] = request.headers.get("anthropic-beta")
        payload = {"question": "Explain power analysis.", "key_points": ["alpha", "power", "MDE"]}
        return httpx.Response(200, json=_message([{"type": "text", "text": json.dumps(payload)}]))

    result = _engine_with(handler, monkeypatch).structured(task="t", system="s", user="u", schema=GeneratedQuestion, effort="low")
    body = seen["body"]
    assert result.question == "Explain power analysis."
    assert body["model"] == "claude-opus-5-5"
    assert body["output_config"]["effort"] == "low"
    assert body["output_config"]["format"]["type"] == "json_schema"
    assert body["fallbacks"] == "default" and seen["beta"] == "server-side-fallback-2026-07-01"
    assert "thinking" not in body and "temperature" not in body


def test_refusal_is_reported_not_faked(monkeypatch):
    def handler(request):
        return httpx.Response(200, json=_message([], stop_reason="refusal"))

    engine = _engine_with(handler, monkeypatch)
    try:
        engine.structured(task="Grade", system="s", user="u", schema=GeneratedQuestion)
    except Exception as exc:
        assert "declined" in str(exc)
    else:
        raise AssertionError("refusal must raise")


def test_agent_loop_uses_strict_tools_and_returns_results(monkeypatch):
    calls = []

    def handler(request):
        body = json.loads(request.content)
        calls.append(body)
        if len(calls) == 1:
            assert all(t["strict"] is True for t in body["tools"])
            return httpx.Response(200, json=_message([{"type": "tool_use", "id": "tu_1", "name": "ping", "input": {}}], "tool_use"))
        assert body["messages"][-1]["content"][0]["type"] == "tool_result"
        return httpx.Response(200, json=_message([{"type": "text", "text": "Done."}]))

    tool = ToolSpec("ping", "Ping.", {"type": "object", "properties": {}, "required": [], "additionalProperties": False}, lambda _: {"ok": True})
    summary = _engine_with(handler, monkeypatch).run_agent(trigger="t", system="s", user="u", tools=[tool])
    assert summary == "Done." and len(calls) == 2
