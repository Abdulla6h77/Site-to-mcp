"""Optional, read-only FDA reference research through the standalone MCP server."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import os
import shutil
import traceback
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlsplit

from google.adk.agents import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event, EventActions
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from pydantic import BaseModel, Field, field_validator


class AdvisoryLink(BaseModel):
    title: str = Field(min_length=1, max_length=350)
    source_url: str = Field(max_length=500)
    publication_date: date | None

    @field_validator("source_url")
    @classmethod
    def _official_source(cls, value: str) -> str:
        url = urlsplit(value)
        if (
            url.scheme != "https"
            or url.netloc != "www.fda.gov"
            or url.query
            or url.fragment
            or not re.fullmatch(
                r"/drugs/(?:drug-safety-communications|drug-safety-and-availability)/"
                r"[a-z0-9-]+",
                url.path,
            )
        ):
            raise ValueError("Expected an FDA advisory URL")
        return value


class Source(AdvisoryLink):
    retrieved_at: datetime
    publisher: Literal["U.S. Food and Drug Administration"]


class SearchResult(BaseModel):
    status: Literal["found", "no_match"]
    results: list[AdvisoryLink] = Field(max_length=1)


class Detail(BaseModel):
    source: Source
    announcement_excerpt: str = Field(min_length=1, max_length=460)
    unavailable_fields: list[str] = Field(max_length=8)


class Warnings(BaseModel):
    source: Source
    status: Literal["available", "not_reported"]
    warning_excerpts: list[str] = Field(max_length=3)
    unavailable_fields: list[str] = Field(max_length=8)


def enabled() -> bool:
    return os.getenv("MEDICINE_MCP_ENABLED", "").lower() in {"1", "true", "yes"}


class ReferenceFailure(ValueError):
    """Sanitized failure from an MCP tool."""


def _diagnostic(error: BaseException) -> str:
    if isinstance(error, BaseExceptionGroup):
        return ", ".join(_diagnostic(item) for item in error.exceptions[:4])
    if isinstance(error, ReferenceFailure):
        return str(error)
    frames = traceback.extract_tb(error.__traceback__)[-1:]
    if frames:
        frame = frames[0]
        return f"{type(error).__name__} in {Path(frame.filename).name}:{frame.name}:{frame.lineno}"
    return type(error).__name__


async def _call(client: ClientSession, name: str, arguments: dict[str, Any]) -> dict:
    result = await client.call_tool(name, arguments)
    if result.isError or not isinstance(result.structuredContent, dict):
        code = "invalid_response"
        content = getattr(result, "content", None)
        if content and getattr(content[0], "type", None) == "text":
            try:
                message = json.loads(content[0].text)
                reported = message.get("code") if isinstance(message, dict) else None
                if isinstance(reported, str) and re.fullmatch(r"[a-z_]{1,40}", reported):
                    code = reported
            except ValueError:
                pass
        raise ReferenceFailure(f"{name}: {code}")
    return result.structuredContent


async def read_reference(client: ClientSession, medicine_name: str) -> dict:
    """Follow a search hit by exact URL and preserve partial evidence."""
    result = SearchResult.model_validate(
        await _call(client, "search_medicines", {"query": medicine_name, "limit": 1})
    )
    if result.status == "no_match" and not result.results:
        return {
            "status": "no_match",
            "message": "No medicine-name match in the FDA advisory archive.",
        }
    if result.status != "found" or not result.results:
        raise ValueError("FDA lookup status and results disagree")
    hit = result.results[0]
    args = {"medicine_name": medicine_name, "source_url": hit.source_url}
    detail = Detail.model_validate(await _call(client, "get_medicine_details", args))
    if detail.source.source_url != hit.source_url:
        raise ValueError("FDA advisory identity changed after lookup")
    evidence = detail.model_dump(mode="json")
    evidence["status"] = "partial"
    evidence["warning_excerpts"] = []
    try:
        warnings = Warnings.model_validate(
            await _call(client, "get_safety_warnings", args)
        )
        if warnings.source.source_url != hit.source_url:
            raise ValueError("FDA warning identity changed after lookup")
        if any(len(item) > 460 for item in warnings.warning_excerpts):
            raise ValueError("FDA warning excerpt exceeded its documented limit")
        evidence["warning_excerpts"] = warnings.warning_excerpts
        evidence["warnings_retrieved_at"] = warnings.source.retrieved_at.isoformat()
        evidence["unavailable_fields"] = list(
            dict.fromkeys([*detail.unavailable_fields, *warnings.unavailable_fields])
        )
        if warnings.status == "available" and warnings.warning_excerpts:
            evidence["status"] = "available"
        else:
            evidence["message"] = "Warning passages were not reported by this lookup."
    except Exception as error:
        logging.getLogger(__name__).warning("FDA warning MCP call failed (%s)", _diagnostic(error))
        evidence["message"] = "The FDA warning lookup failed; reference evidence is incomplete."
    return evidence


async def research_reference(medicine_name: str) -> dict:
    node = shutil.which("node")
    key = os.getenv("TINYFISH_API_KEY", "").strip()
    if not node or not key:
        return {"status": "unavailable", "message": "The FDA MCP runtime is not configured."}
    directory = Path(__file__).resolve().parents[1] / "mcp-server"
    env = {"TINYFISH_API_KEY": key}
    if rate_db := os.getenv("SITE_MCP_RATE_DB"):
        env["SITE_MCP_RATE_DB"] = rate_db
    params = StdioServerParameters(
        command=node, args=[str(directory / "server.ts")], cwd=directory, env=env
    )
    stage = "starting stdio transport"
    evidence = None
    try:
        async with asyncio.timeout(225), stdio_client(params) as (read, write):
            stage = "initializing MCP session"
            async with ClientSession(read, write, read_timeout_seconds=timedelta(seconds=120)) as client:
                await client.initialize()
                stage = "calling FDA reference tools"
                evidence = await read_reference(client, medicine_name)
                stage = "closing MCP session"
        return evidence
    except Exception as error:
        diagnostic = _diagnostic(error)
        logging.getLogger(__name__).warning("FDA reference MCP lookup failed at %s (%s)", stage, diagnostic)
        if evidence is not None:
            return evidence
        return {
            "status": "unavailable",
            "message": "The FDA MCP lookup did not complete. The original research paths are still available.",
        }


class FdaReferenceAgent(BaseAgent):
    """Read only the medicine name from trusted session state."""

    async def _run_async_impl(self, ctx: InvocationContext):
        medicine_name = ctx.session.state.get("research_medicine_name")
        if not enabled() or not isinstance(medicine_name, str) or not medicine_name:
            return
        evidence = await research_reference(medicine_name)
        yield Event(
            author=self.name,
            invocation_id=ctx.invocation_id,
            actions=EventActions(state_delta={"mcp_reference": evidence}),
        )
