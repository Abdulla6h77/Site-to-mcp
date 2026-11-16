from __future__ import annotations

from dotenv import load_dotenv

load_dotenv()

"""FastAPI server for the medicine-autopilot pipeline.

Implements Feature 2 from SPEC.md:
- POST /search     triggers the ADK root_agent pipeline, returns pause report.
- POST /approve    persists the server-side report after explicit approval.
- GET  /history    lists reports from SQLite, optionally including pending reports.
- GET  /reports/{session_id} reopens a report from SQLite.

All endpoints return ``{"status": "error", "message": "..."}`` on failure.
Stack traces are logged server-side but never returned to the client.
Secrets and URLs are loaded from environment variables only.
"""

import json
import logging
import os
import sqlite3
import threading
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from pydantic import BaseModel, Field

from app.agent import MedicineSummary, WarningAssessment, root_agent
from app.app_utils.trace import collect_trace
from app.mcp_reference import enabled as fda_reference_enabled

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("medicine-autopilot.api")

APP_NAME = "medicine-autopilot"
USER_ID = "frontend"
DEFAULT_DB_PATH = str(Path(__file__).resolve().parents[1] / "db" / "reports.db")
DEFAULT_ORIGIN = "http://localhost:3000"

# -- Environment-driven configuration -----------------------------------------

DB_PATH = os.getenv("DB_PATH", DEFAULT_DB_PATH)
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", DEFAULT_ORIGIN).split(",")
    if origin.strip()
]

# -- ADK runner singleton -----------------------------------------------------
# A single Runner is shared across requests; session state lives in the
# in-memory session service while the research agents run.

_session_service = InMemorySessionService()
_runner = Runner(
    agent=root_agent,
    app_name=APP_NAME,
    session_service=_session_service,
)

# -- SQLite store -------------------------------------------------------------

_db_lock = threading.Lock()


def _db_path() -> str:
    """Return the configured SQLite path and ensure its parent exists."""

    path = os.getenv("DB_PATH", DB_PATH)
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    return path


def _connect() -> sqlite3.Connection:
    """Open a SQLite connection with cross-thread access enabled."""

    conn = sqlite3.connect(_db_path(), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _init_db() -> None:
    """Initialize SQLite without rewriting existing reports."""

    with _db_lock:
        conn = _connect()
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS approved_reports (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    medicine_name TEXT,
                    date          TEXT,
                    severity      TEXT,
                    report        TEXT,
                    session_id    TEXT
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS pending_reports (
                    session_id TEXT PRIMARY KEY,
                    medicine_name TEXT NOT NULL,
                    date TEXT NOT NULL,
                    report TEXT NOT NULL
                )
                """
            )
            conn.commit()
        finally:
            conn.close()


_init_db()


def _save_pending(report: dict[str, Any], medicine_name: str) -> None:
    with closing(_connect()) as conn, conn:
        conn.execute(
            """
            INSERT INTO pending_reports (session_id, medicine_name, date, report)
            VALUES (?, ?, ?, ?)
            """,
            (report["session_id"], medicine_name.strip(),
             datetime.now(timezone.utc).isoformat(), json.dumps(report, ensure_ascii=False)),
        )


def _approve_pending(session_id: str) -> bool:
    with closing(_connect()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT medicine_name, report FROM pending_reports WHERE session_id = ?", (session_id,)
        ).fetchone()
        if row is None:
            return False
        report = json.loads(row["report"])
        report["status"] = "approved"
        conn.execute(
            """
            INSERT INTO approved_reports (medicine_name, date, severity, report, session_id)
            VALUES (?, ?, ?, ?, ?)
            """,
            (row["medicine_name"], datetime.now(timezone.utc).isoformat(),
             report["warning_assessment"]["severity"], json.dumps(report, ensure_ascii=False),
             session_id),
        )
        conn.execute("DELETE FROM pending_reports WHERE session_id = ?", (session_id,))
        return True


def _load_report(session_id: str) -> dict[str, Any] | None:
    with closing(_connect()) as conn:
        if session_id.startswith("legacy-") and session_id[7:].isdigit():
            row = conn.execute(
                "SELECT report, 'approved' AS status FROM approved_reports WHERE id = ?",
                (session_id[7:],),
            ).fetchone()
        else:
            row = conn.execute(
                """
                SELECT report, 'awaiting_human_review' AS status FROM pending_reports WHERE session_id = ?
                UNION ALL
                SELECT report, 'approved' AS status FROM approved_reports WHERE session_id = ?
                LIMIT 1
                """,
                (session_id, session_id),
            ).fetchone()
    if row is None:
        return None
    return {**json.loads(row["report"] or "{}"), "session_id": session_id, "status": row["status"]}


def _load_history(include_pending: bool) -> list[dict[str, Any]]:
    query = """
        SELECT id, medicine_name, date, severity, report, session_id, 'approved' AS status
        FROM approved_reports
    """
    if include_pending:
        query += """
        UNION ALL
        SELECT NULL AS id, medicine_name, date, NULL AS severity, report, session_id,
               'awaiting_human_review' AS status
        FROM pending_reports
        """
    with closing(_connect()) as conn:
        rows = conn.execute(query + " ORDER BY date DESC, id DESC").fetchall()

    history = []
    for row in rows:
        entry = dict(row)
        report_raw = entry["report"] or "{}"
        try:
            entry["report"] = json.loads(report_raw)
        except (TypeError, ValueError):
            entry["report"] = {"raw": report_raw}
        if not include_pending:
            entry.pop("status")
        history.append(entry)
    return history


# -- ADK pipeline helpers -----------------------------------------------------


def _build_user_message(medicine_name: str, patient_context: str) -> str:
    """Serialize the /search input into the user message the agents read."""

    context = (patient_context or "").strip()
    return f"medicine_name={medicine_name.strip()}\npatient_context={context}"


def _coerce_state_json(value: Any) -> Any:
    """Return a JSON-compatible Python value from a session-state slot.

    ADK output may already be structured or arrive as JSON text.
    """

    if isinstance(value, (dict, list)):
        return value
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return text


def _state_value(state: Any, key: str) -> Any:
    """Look up a session-state key, tolerating dict or mapping objects."""

    if state is None:
        return None
    if isinstance(state, dict):
        return state.get(key)
    getter = getattr(state, "get", None)
    if callable(getter):
        try:
            return getter(key)
        except Exception:  # noqa: BLE001 - never propagate from a helper
            return None
    return None


def _run_research(
    message: types.Content, medicine_name: str = ""
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Run research and build a server-side report for human review."""

    initial_state = (
        {"research_medicine_name": medicine_name.strip()}
        if medicine_name.strip() and fda_reference_enabled()
        else None
    )
    session = _session_service.create_session_sync(
        app_name=APP_NAME, user_id=USER_ID, state=initial_state
    )
    session_id = session.id

    trace = collect_trace(
        _runner,
        user_id=USER_ID,
        session_id=session_id,
        new_message=message,
    )

    refreshed = _session_service.get_session_sync(
        app_name=APP_NAME, user_id=USER_ID, session_id=session_id
    )
    state = getattr(refreshed, "state", {}) or {}
    logging.info("Session state keys: %s", list(state.keys()))

    label_url = _state_value(state, "official_label_url")
    sources = [label_url] if isinstance(label_url, str) and label_url else []
    summary = _coerce_state_json(_state_value(state, "medicine_summary"))
    assessment = _coerce_state_json(_state_value(state, "warning_assessment"))
    ready = (
        isinstance(summary, dict) and bool(summary)
        and isinstance(assessment, dict) and bool(assessment)
    )
    if ready:
        summary = MedicineSummary.model_validate(summary).model_dump()
        assessment = WarningAssessment.model_validate(assessment).model_dump()

    payload = {
        "session_id": session_id,
        "medicine_summary": summary or {},
        "warning_assessment": assessment or {},
        "sources": sources,
        "status": "awaiting_human_review",
    }
    if not ready:
        payload["status"] = "error"
        payload["message"] = "Research was incomplete. No report was saved."
    if sources:
        payload["label_source_url"] = sources[0]
    if isinstance(reference := _state_value(state, "mcp_reference"), dict):
        payload["mcp_reference"] = reference
        if isinstance(reference.get("source"), dict):
            url = reference["source"].get("source_url")
            if url and url not in sources:
                sources.append(url)
    return payload, trace


# -- Request / response models ------------------------------------------------


class SearchRequest(BaseModel):
    medicine_name: str = Field(..., min_length=1)
    patient_context: str = ""


class ApproveRequest(BaseModel):
    session_id: str = Field(..., min_length=1)


app = FastAPI(title="medicine-autopilot", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _error(message: str) -> dict[str, str]:
    """Build the spec's standard error envelope."""

    return {"status": "error", "message": message}


def _safe_message(exc: Exception, fallback: str) -> str:
    """Return a stack-trace-free error message safe to send to the client."""

    text = str(exc).strip()
    if not text:
        return fallback
    # Cap length so a runaway error cannot bloat the response.
    return text[:300] or fallback


@app.exception_handler(RequestValidationError)
async def _validation_handler(
    _request: Request, exc: RequestValidationError
) -> JSONResponse:
    return JSONResponse(status_code=422, content=_error("Invalid request payload."))


@app.get("/health")
def health() -> dict[str, str]:
    """Lightweight liveness probe."""

    return {"status": "ok"}


@app.post("/search")
def search(payload: SearchRequest) -> dict[str, Any]:
    """Trigger the ADK pipeline and return the human-review pause report."""

    try:
        message = types.Content(
            role="user",
            parts=[
                types.Part.from_text(
                    text=_build_user_message(
                        payload.medicine_name, payload.patient_context
                    )
                )
            ],
        )
        report, trace = _run_research(message, payload.medicine_name)
        if report["status"] == "error":
            return {**report, "trace": trace}
        _save_pending(report, payload.medicine_name)
        response = dict(report)
        response["trace"] = trace
        return response
    except Exception as exc:  # noqa: BLE001 - top-level guard per spec
        logger.exception("POST /search failed")
        return _error(_safe_message(exc, "Pipeline failed to start."))


@app.post("/approve")
def approve(payload: ApproveRequest) -> dict[str, str]:
    """Save the server-side report after an explicit approval request."""

    try:
        if not _approve_pending(payload.session_id):
            return _error("No report is awaiting approval for this session.")
        return {"status": "saved"}
    except Exception as exc:  # noqa: BLE001 - top-level guard per spec
        logger.exception("POST /approve failed")
        return _error(_safe_message(exc, "Failed to save approved report."))


@app.get("/history")
def history(include_pending: bool = False) -> Any:
    """Return all approved reports from SQLite."""

    try:
        return _load_history(include_pending)
    except Exception as exc:  # noqa: BLE001 - top-level guard per spec
        logger.exception("GET /history failed")
        return _error(_safe_message(exc, "Failed to load history."))


@app.get("/reports/{session_id}")
def get_report(session_id: str) -> Any:
    try:
        report = _load_report(session_id)
        if report is not None:
            return report
        return JSONResponse(status_code=404, content=_error("Report not found."))
    except (sqlite3.Error, ValueError, TypeError):
        logger.exception("GET /reports failed")
        return JSONResponse(status_code=500, content=_error("Unable to load the report."))
