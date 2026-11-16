"""Fixture-backed contracts for the optional FDA reference adapter."""

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from app import mcp_reference as reference

URL = "https://www.fda.gov/drugs/drug-safety-communications/test-advisory"
SOURCE = {
    "title": "FDA fixture advisory",
    "source_url": URL,
    "publication_date": "2020-03-04",
    "retrieved_at": datetime.now(timezone.utc).isoformat(),
    "publisher": "U.S. Food and Drug Administration",
}


class FixtureClient:
    def __init__(self, *, missing=False, warning_error=False):
        self.calls = []
        self.missing = missing
        self.warning_error = warning_error

    async def call_tool(self, name, args):
        self.calls.append((name, args))
        if name == "search_medicines":
            value = (
                {"status": "no_match", "results": []}
                if self.missing else {"status": "found", "results": [SOURCE]}
            )
        elif name == "get_medicine_details":
            value = {
                "source": SOURCE,
                "announcement_excerpt": "Fixture reference content.",
                "unavailable_fields": ["complete prescribing information"],
            }
        else:
            value = {
                "source": SOURCE,
                "status": "available",
                "warning_excerpts": ["Fixture warning excerpt."],
                "unavailable_fields": ["patient-specific advice"],
            }
        return SimpleNamespace(
            isError=name == "get_safety_warnings" and self.warning_error,
            structuredContent=value,
        )


@pytest.mark.asyncio
async def test_reference_passes_only_medicine_and_official_source():
    client = FixtureClient()
    result = await reference.read_reference(client, "sample-medicine")
    assert result["status"] == "available"
    assert result["source"]["source_url"] == URL
    assert result["warnings_retrieved_at"]
    assert [name for name, _ in client.calls] == [
        "search_medicines", "get_medicine_details", "get_safety_warnings"
    ]
    assert client.calls[0][1] == {"query": "sample-medicine", "limit": 1}
    assert client.calls[1][1] == {"medicine_name": "sample-medicine", "source_url": URL}


@pytest.mark.asyncio
async def test_no_match_and_partial_are_explicit():
    missing = FixtureClient(missing=True)
    assert (await reference.read_reference(missing, "sample-medicine"))["status"] == "no_match"
    assert len(missing.calls) == 1
    partial = await reference.read_reference(FixtureClient(warning_error=True), "sample-medicine")
    assert partial["status"] == "partial"
    assert partial["warning_excerpts"] == []
    assert "failed" in partial["message"]


@pytest.mark.asyncio
async def test_adk_receives_evidence_in_session_without_sending_patient_context(monkeypatch):
    monkeypatch.setenv("MEDICINE_MCP_ENABLED", "true")

    async def retrieve(name):
        assert name == "sample-medicine"
        return {"status": "no_match"}

    monkeypatch.setattr(reference, "research_reference", retrieve)
    sessions = InMemorySessionService()
    session = await sessions.create_session(
        app_name="fixture",
        user_id="tester",
        state={"research_medicine_name": "sample-medicine"},
    )
    runner = Runner(
        agent=reference.FdaReferenceAgent(name="FdaReferenceAgent"),
        app_name="fixture", session_service=sessions,
    )
    message = types.Content(role="user", parts=[types.Part.from_text(text="private fixture context")])
    events = [event async for event in runner.run_async(
        user_id="tester", session_id=session.id, new_message=message
    )]
    assert any(event.actions.state_delta.get("mcp_reference") for event in events)
    saved = await sessions.get_session(app_name="fixture", user_id="tester", session_id=session.id)
    assert saved.state["mcp_reference"] == {"status": "no_match"}
