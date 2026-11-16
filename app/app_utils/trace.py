"""Trace capture helper for the ADK Runner event stream.

`collect_trace` is a pure observer: it drives a `Runner` to completion and
returns an ordered, human-readable list of what each event represents — agent
start/end, tool call, tool result, agent output, human-review pause, error.

The runner and its agents are NOT modified. The helper breaks on the same
`request_input` marker that the existing pipeline (`_run_until_pause`) uses,
so the pipeline behavior is identical with and without trace collection.

Spec: SPEC.md Feature 5 (Natural-Language Chat Interface).
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from google.adk.runners import Runner
from google.genai import types

logger = logging.getLogger("medicine-autopilot.trace")

# Maps the known tool function names to short human-readable labels.
# Adding new agents should not require touching this — unknown names fall
# back to a generic "Calling <name>" label.
_KNOWN_TOOLS = {
    "search_official_label": "Searching DailyMed for a drug label",
    "fetch_official_label": "Reading the selected DailyMed label",
}

_MAX_LABEL_CHARS = 160


def _now_iso() -> str:
    """Return an ISO-8601 UTC timestamp captured at event yield time."""

    return datetime.now(timezone.utc).isoformat()


def _truncate(text: str, limit: int = _MAX_LABEL_CHARS) -> str:
    """Cap a string for the trace label. Never include raw payloads."""

    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def _first_text_from_event(event: Any) -> str:
    """Return the concatenated text from an event's content parts, ignoring
    function-call / function-response parts. Used for ``agent_output`` labels.
    """

    content = getattr(event, "content", None)
    parts = getattr(content, "parts", None) or []
    chunks: list[str] = []
    for part in parts:
        text = getattr(part, "text", None)
        if isinstance(text, str) and text:
            chunks.append(text)
    return "".join(chunks)


def _summarize_tool_call(name: str, args: Any) -> str:
    """Build a short label for a tool-call event, never including raw payload."""

    base = _KNOWN_TOOLS.get(name, f"Calling {name}")
    # Include one concise argument for context.
    if isinstance(args, dict):
        for key in ("medicine_name", "source_url"):
            if key in args:
                value = args[key]
                if isinstance(value, str) and value:
                    return f"{base} ({key}=\"{_truncate(value, 60)}\")"
                if isinstance(value, (int, float)):
                    return f"{base} ({key}={value})"
        if not args:
            return base
    return base


def _summarize_tool_result(name: str, response: Any) -> str:
    """Build a short label for a tool-result event."""

    if name == "search_official_label":
        if isinstance(response, dict):
            results = response.get("results") or []
            return f"Got {len(results)} search result(s)"
    if name == "fetch_official_label":
        if isinstance(response, dict):
            content = response.get("content") or ""
            if isinstance(content, str) and content:
                return f"Fetched {len(content):,} chars from the top result"
    if isinstance(response, dict):
        if response.get("status") == "error":
            return f"Tool {name} returned an error"
    return f"Tool {name} returned a result"


def collect_trace(
    runner: Runner,
    *,
    user_id: str,
    session_id: str,
    new_message: types.Content,
) -> list[dict[str, Any]]:
    """Drive the runner and return a list of trace entries.

    Each entry has the spec shape::

        {
            "seq": int,             # 1-indexed
            "ts": str,              # ISO-8601 UTC at event yield time
            "event_type": str,      # agent_start | tool_call | tool_result |
                                    # agent_output | agent_end | error
            "agent_name": str,      # event.author (e.g. "SearchAgent")
            "label": str,           # short human-readable summary
        }

    The function does NOT modify the runner, agents, session state, or
    environment. It only observes the event stream.

    Args:
        runner: The ADK Runner to drive.
        user_id: ADK session user id.
        session_id: ADK session id.
        new_message: The Content to pass to runner.run.

    Returns:
        The ordered list of trace entries. Never empty when the runner
        yields at least one event; returns ``[]`` if the runner yields
        nothing at all.
    """

    trace: list[dict[str, Any]] = []
    seen_authors: set[str] = set()
    counter = 0

    try:
        for event in runner.run(
            user_id=user_id,
            session_id=session_id,
            new_message=new_message,
        ):
            counter += 1
            author = str(getattr(event, "author", "") or "")
            actions = getattr(event, "actions", None)
            end_of_agent = bool(getattr(actions, "end_of_agent", None))
            function_calls = list(event.get_function_calls() or [])
            function_responses = list(event.get_function_responses() or [])
            text = _first_text_from_event(event)

            # 1) tool_call (function call parts, no function response parts)
            if function_calls and not function_responses:
                for fc in function_calls:
                    fname = str(getattr(fc, "name", "") or "tool")
                    fargs = getattr(fc, "args", None)
                    trace.append(
                        {
                            "seq": len(trace) + 1,
                            "ts": _now_iso(),
                            "event_type": "tool_call",
                            "agent_name": author or "agent",
                            "label": _summarize_tool_call(fname, fargs),
                        }
                    )
                if author and author not in seen_authors and author != "user":
                    seen_authors.add(author)
                continue

            # 2) tool_result (function response parts)
            if function_responses:
                for fr in function_responses:
                    fname = str(getattr(fr, "name", "") or "tool")
                    response = getattr(fr, "response", None)
                    trace.append(
                        {
                            "seq": len(trace) + 1,
                            "ts": _now_iso(),
                            "event_type": "tool_result",
                            "agent_name": author or "agent",
                            "label": _summarize_tool_result(fname, response),
                        }
                    )
                continue

            # 3) end_of_agent flag — record before agent_output text to keep
            #    ordering natural for the frontend.
            if end_of_agent:
                trace.append(
                    {
                        "seq": len(trace) + 1,
                        "ts": _now_iso(),
                        "event_type": "agent_end",
                        "agent_name": author or "agent",
                        "label": f"Finished {author}" if author else "Agent finished",
                    }
                )
                continue

            # 4) text content — agent output (only for agents, not "user").
            if text and author and author != "user":
                trace.append(
                    {
                        "seq": len(trace) + 1,
                        "ts": _now_iso(),
                        "event_type": "agent_output",
                        "agent_name": author,
                        "label": _truncate(text, 120),
                    }
                )
                if author not in seen_authors:
                    seen_authors.add(author)
                    # Insert an agent_start just before this output entry so
                    # the trace shows the agent "turning on" before speaking.
                    trace.insert(
                        len(trace) - 1,
                        {
                            "seq": len(trace),  # will be re-sequenced below
                            "ts": _now_iso(),
                            "event_type": "agent_start",
                            "agent_name": author,
                            "label": f"Starting {author}",
                        },
                    )
                continue

            # 5) New agent appearing without text — emit agent_start.
            if author and author != "user" and author not in seen_authors:
                seen_authors.add(author)
                trace.append(
                    {
                        "seq": len(trace) + 1,
                        "ts": _now_iso(),
                        "event_type": "agent_start",
                        "agent_name": author,
                        "label": f"Starting {author}",
                    }
                )
                continue

            # 7) Anything else (user message, system noise) is dropped from
            # the trace — it would add clutter without information.
    except Exception as exc:  # noqa: BLE001 - record & re-raise
        trace.append(
            {
                "seq": len(trace) + 1,
                "ts": _now_iso(),
                "event_type": "error",
                "agent_name": "",
                "label": f"Runner raised: {type(exc).__name__}",
            }
        )
        # Re-raise so callers can still apply their existing try/except.
        raise

    # Re-number seq after any insert() calls above so the order is dense.
    for i, entry in enumerate(trace, start=1):
        entry["seq"] = i
    return trace
