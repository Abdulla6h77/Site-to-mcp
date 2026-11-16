"""TinyFish tool wrappers for the medicine autopilot pipeline."""

from __future__ import annotations

import os
from typing import Any
from urllib.parse import urlsplit

import requests
from google.adk.tools import ToolContext

MAX_FETCHED_CONTENT_CHARS = 5000


def _tinyfish_headers() -> dict[str, str]:
    api_key = os.getenv("TINYFISH_API_KEY", "").strip().strip('"')
    return {"X-API-Key": api_key, "Content-Type": "application/json"}


def _env_value(name: str) -> str:
    return os.getenv(name, "").strip().strip('"')


def _extract_results(payload: dict[str, Any]) -> list[dict[str, Any]]:
    for key in ("results", "data", "items", "organic_results"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def _first_url(results: list[dict[str, Any]]) -> str:
    for item in results:
        url = item.get("url") or item.get("link") or item.get("href")
        if isinstance(url, str) and url.startswith(("http://", "https://")):
            return url
    return ""


def _normalize_search_result(item: dict[str, Any]) -> dict[str, str]:
    url = item.get("url") or item.get("link") or item.get("href") or ""
    title = item.get("title") or item.get("name") or ""
    snippet = (
        item.get("snippet") or item.get("description") or item.get("summary") or ""
    )
    return {"url": str(url), "title": str(title), "snippet": str(snippet)}


def _extract_content(payload: Any) -> str:
    if isinstance(payload, str):
        return payload

    if isinstance(payload, list):
        return "\n\n".join(_extract_content(item) for item in payload)

    if not isinstance(payload, dict):
        return ""

    for key in ("content", "text", "markdown", "html"):
        value = payload.get(key)
        if isinstance(value, str):
            return value

    for key in ("results", "data", "items", "documents"):
        value = payload.get(key)
        if isinstance(value, (dict, list)):
            content = _extract_content(value)
            if content:
                return content

    return ""


def search_medicine(medicine_name: str) -> dict[str, Any]:
    """Searches the web for a medicine using TinyFish Search API.

    Args:
        medicine_name: The medicine name to search for.

    Returns:
        Search metadata, normalized result items, and the selected top URL.
    """

    endpoint = _env_value("TINYFISH_SEARCH_URL")
    api_key = _env_value("TINYFISH_API_KEY")
    if not endpoint:
        return {"status": "error", "message": "TINYFISH_SEARCH_URL is not set."}
    if not api_key:
        return {"status": "error", "message": "TINYFISH_API_KEY is not set."}

    try:
        response = requests.get(
            endpoint,
            headers=_tinyfish_headers(),
            params={"query": medicine_name},
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException as exc:
        return {"status": "error", "message": f"TinyFish search failed: {exc}"}
    except ValueError as exc:
        return {
            "status": "error",
            "message": f"TinyFish search returned invalid JSON: {exc}",
        }

    results = [_normalize_search_result(item) for item in _extract_results(payload)]
    return {"status": "success", "results": results[:5]}


def fetch_top_result(search_results: dict[str, Any], *, official_label: bool = False) -> dict[str, Any]:
    """Fetches content from the top URL using TinyFish Fetch API.

    Args:
        search_results: Output from search_medicine containing a top_url.

    Returns:
        Fetched source URL, content text, and response metadata.
    """

    endpoint = _env_value("TINYFISH_FETCH_URL")
    api_key = _env_value("TINYFISH_API_KEY")
    if not endpoint:
        return {"status": "error", "message": "TINYFISH_FETCH_URL is not set."}
    if not api_key:
        return {"status": "error", "message": "TINYFISH_API_KEY is not set."}

    if search_results.get("status") == "error":
        message = search_results.get("message", "Search failed before fetch.")
        return {"status": "error", "message": f"Cannot fetch: {message}"}

    url = search_results.get("top_url") or _first_url(search_results.get("results", []))
    if not url:
        return {"status": "error", "message": "No fetchable URL was found."}

    try:
        response = requests.post(
            endpoint,
            headers=_tinyfish_headers(),
            json={"urls": [url]},
            timeout=45,
        )
        response.raise_for_status()
        payload = response.json()
    except requests.RequestException as exc:
        return {"status": "error", "message": f"TinyFish fetch failed: {exc}"}
    except ValueError as exc:
        return {
            "status": "error",
            "message": f"TinyFish fetch returned invalid JSON: {exc}",
        }

    if official_label:
        rows = _extract_results(payload)
        final_url = (rows[0].get("final_url") or rows[0].get("url")) if len(rows) == 1 else None
        if not isinstance(final_url, str) or not _is_label_url(final_url):
            return {"status": "error", "message": "DailyMed did not return a verified label URL."}
        url = final_url
    content = _extract_content(payload)[:MAX_FETCHED_CONTENT_CHARS]
    if official_label and not content.strip():
        return {"status": "error", "message": "DailyMed returned no readable label content."}
    return {"status": "success", "content": content, **({"source_url": url} if official_label else {})}


def _is_label_url(value: str) -> bool:
    url = urlsplit(value)
    return (
        url.scheme == "https"
        and url.netloc == "dailymed.nlm.nih.gov"
        and url.path.casefold() == "/dailymed/druginfo.cfm"
    )


def search_official_label(medicine_name: str) -> dict[str, Any]:
    """Find DailyMed label candidates for a medicine."""
    result = search_medicine(f"{medicine_name} site:dailymed.nlm.nih.gov/dailymed/drugInfo.cfm")
    if result.get("status") == "success":
        result["results"] = [row for row in result["results"] if _is_label_url(row["url"])]
        if not result["results"]:
            return {"status": "error", "message": "No DailyMed label candidates were found."}
    return result


def fetch_official_label(source_url: str, tool_context: ToolContext) -> dict[str, Any]:
    """Read a selected DailyMed label."""
    if not _is_label_url(source_url):
        return {"status": "error", "message": "Expected a DailyMed drug label URL."}
    result = fetch_top_result({"top_url": source_url}, official_label=True)
    if result["status"] == "success":
        tool_context.state["official_label_url"] = result["source_url"]
    return result
