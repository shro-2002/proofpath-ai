import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import llm
from app.offline_engine import OfflineEngine

SAMPLE = json.loads((Path(__file__).resolve().parent.parent / "demo_data" / "sample.json").read_text())


class FakeEngine(OfflineEngine):
    """Offline heuristics by default; individual tests override pieces to simulate model behaviour."""

    name = "fake"
    label = "Test fake"

    def __init__(self):
        self.overrides = {}
        self.agent_policy = None
        self.fail_with = None

    def structured(self, *, task, system, user, schema, effort="low"):
        if self.fail_with:
            raise self.fail_with
        if schema in self.overrides:
            return self.overrides[schema](user)
        return super().structured(task=task, system=system, user=user, schema=schema, effort=effort)

    def run_agent(self, *, trigger, system, user, tools, max_steps=6):
        if self.fail_with:
            raise self.fail_with
        if self.agent_policy:
            return self.agent_policy(trigger, user, {t.name: t.handler for t in tools})
        return super().run_agent(trigger=trigger, system=system, user=user, tools=tools, max_steps=max_steps)


@pytest.fixture
def engine():
    fake = FakeEngine()
    llm.set_engine(fake)
    yield fake
    llm.set_engine(None)


@pytest.fixture
def client(tmp_path, monkeypatch, engine):
    monkeypatch.setenv("PROOFPATH_DB", str(tmp_path / "test.db"))
    from app.main import create_app

    with TestClient(create_app()) as c:
        yield c


@pytest.fixture
def sample():
    return json.loads(json.dumps(SAMPLE))


@pytest.fixture
def onboarded(client, sample):
    response = client.post("/api/intake", json=sample)
    assert response.status_code == 200, response.text
    return client
