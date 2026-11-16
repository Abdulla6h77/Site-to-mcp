"""Exercise FDA provenance through the actual FastAPI approval routes with fixture ADK state."""

from types import SimpleNamespace

from fastapi.testclient import TestClient


def test_only_completed_server_report_can_be_approved(monkeypatch, tmp_path):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "reports.db"))
    monkeypatch.setenv("MEDICINE_MCP_ENABLED", "true")
    from backend import main

    main._init_db()
    fda = {"status": "available", "source": {
        "source_url": "https://www.fda.gov/drugs/drug-safety-communications/fixture-advisory"
    }}
    state = {"mcp_reference": fda}

    def create_session_sync(**kwargs):
        assert kwargs["state"] == {"research_medicine_name": "fixture medicine"}
        return SimpleNamespace(id="fixture-session")

    sessions = SimpleNamespace(
        create_session_sync=create_session_sync,
        get_session_sync=lambda **kwargs: SimpleNamespace(state=state),
    )
    monkeypatch.setattr(main, "_session_service", sessions)
    monkeypatch.setattr(main, "collect_trace", lambda *a, **k: [])

    with TestClient(main.app) as client:
        query = {"medicine_name": "fixture medicine", "patient_context": "private fixture"}
        failed = client.post("/search", json=query).json()
        assert failed["status"] == "error"
        assert failed["mcp_reference"] == fda
        assert client.post("/approve", json={"session_id": "fixture-session", "report": failed}).json()["status"] == "error"
        assert client.get("/history").json() == []

        label = "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=fixture"
        state.update(
            official_label_url=label,
            medicine_summary={"generic_name": "fixture medicine"},
            warning_assessment={"severity": "medium"},
        )
        report = client.post("/search", json=query).json()
        assert report["status"] == "awaiting_human_review"
        assert report["mcp_reference"] == fda
        assert report["sources"] == [label, fda["source"]["source_url"]]
        assert report["label_source_url"] == label
        saved_id = report["session_id"]
        assert client.get(f"/reports/{saved_id}").json()["status"] == "awaiting_human_review"
        assert client.get("/history?include_pending=true").json()[0]["session_id"] == saved_id
        assert client.get("/reports/missing").status_code == 404
        state.clear()
        main._init_db()
        assert client.get("/history").json() == []
        approved = client.post("/approve", json={
            "session_id": report["session_id"],
            "report": {"medicine_summary": {"generic_name": "client replacement"}},
        })
        assert approved.json()["status"] == "saved"
        assert client.post("/approve", json={"session_id": report["session_id"]}).json()["status"] == "error"
        history = client.get("/history").json()
        assert len(history) == 1
        assert history[0]["report"]["medicine_summary"]["generic_name"] == "fixture medicine"
        assert client.get(f"/reports/{saved_id}").json()["status"] == "approved"
        assert client.get("/history?include_pending=true").json()[0]["status"] == "approved"
