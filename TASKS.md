# TASKS

> The sections below document the original prototype. The current submission uses medicine search, persistent research history, and explicit approval. Chat, pharmacy location, and price lookup were retired. See [README.md](README.md) and the standalone [Site to MCP specification](mcp-server/SPEC.md).

The sections below record the original hackathon milestones.

## Milestone 1: Feature 1 - Agent Pipeline

1. [x] Scaffold a prototype ADK project for `medicine-autopilot` with deployment target `none`.
2. [x] Configure the project to use Qwen through LiteLLM with `model="dashscope/qwen-plus"`.
3. [x] Define the sequential agent pipeline in `app/agent.py` with SearchAgent, FetchAgent, SummaryAgent, WarningAgent, and HumanReviewCheckpoint.
4. [x] Enable ADK resumability with `ResumabilityConfig` so the human review checkpoint can preserve session state.
5. [x] Implement `search_medicine(medicine_name)` in `app/tools.py` using TinyFish Search with environment-provided URL and API key.
6. [x] Implement `fetch_top_result(search_results)` in `app/tools.py` using TinyFish Fetch with environment-provided URL and API key.
7. [x] Ensure TinyFish tool failures return `{"status": "error", "message": "..."}` instead of raising exceptions.
8. [x] Ensure fetched TinyFish content is trimmed to 5000 characters before returning.
9. [x] Run scaffold verification: dependency install, lint/type checks, unit tests, and import smoke check.
10. [x] Align `MedicineSummary` in `app/agent.py` exactly with `SPEC.md`, including `dosage: str`.
11. [x] Align `WarningAssessment` in `app/agent.py` exactly with `SPEC.md`, including `interactions`, `pregnancy_risk`, `age_risk`, and severity enum values `low`, `medium`, `high`.
12. [x] Ensure SearchAgent returns top 5 URLs and snippets as required by `SPEC.md`.
13. [x] Ensure FetchAgent fetches content from the first URL in search results and continues cleanly when search failed.
14. [x] Ensure SummaryAgent produces a valid `MedicineSummary` even when fetched content is missing or an upstream tool returned an error.
15. [x] Ensure WarningAgent evaluates `MedicineSummary` against the optional `patient_context` input.
16. [x] Ensure HumanReviewCheckpoint returns the full report payload with `session_id`, `medicine_summary`, `warning_assessment`, `sources`, and `status: "awaiting_human_review"`.
17. [x] Integration-test the full pipeline with real or mocked TinyFish responses.
18. [x] Integration-test the full pipeline with Qwen through the DashScope international endpoint.
19. [x] Add 1-2 evaluation cases for common medicine queries and red-flag patient contexts.
20. [x] Run `agents-cli eval generate` and `agents-cli eval grade` for the initial pipeline eval set.

## Milestone 2: Feature 2 - FastAPI Server

21. [x] Implement `POST /search` to accept `medicine_name` and optional `patient_context`.
22. [x] Make `POST /search` trigger the agent pipeline and return the pause report plus `session_id`.
23. [x] Ensure `POST /search` returns `{"status": "error", "message": "..."}` on failure without exposing stack traces.
24. [x] Implement SQLite schema for approved reports.
25. [x] Implement `POST /approve` to resume the paused session after human approval.
26. [x] Make `POST /approve` save the approved report to SQLite.
27. [x] Ensure `POST /approve` returns `{"status": "error", "message": "..."}` on failure without exposing stack traces.
28. [x] Implement `GET /history` to return approved reports from SQLite.
29. [x] Ensure `GET /history` returns `{"status": "error", "message": "..."}` on failure without exposing stack traces.
30. [x] Add unit tests for request validation and error responses for all FastAPI endpoints.
31. [x] Add integration tests for `/search`, `/approve`, and `/history` using a temporary SQLite database.
32. [x] Confirm the frontend-facing API never exposes TinyFish or DashScope secrets.

## Milestone 3: Feature 3 - Next.js Frontend

33. [x] Scaffold the Next.js app inside `frontend/`.
34. [ ] Implement the `/` search page with required medicine name input and optional patient context textarea.
35. [ ] Wire the "Run Pipeline" button to call backend `POST /search`.
36. [ ] Add loading state that shows pipeline step progress while `/search` is running.
37. [ ] Redirect to `/review` after a successful `/search` response.
38. [ ] Implement `/review` to display `MedicineSummary` in structured cards.
39. [ ] Implement `/review` to display `WarningAssessment` with severity colors: high red, medium orange, low green.
40. [ ] List source URLs at the bottom of `/review`.
41. [ ] Add the disclaimer banner: "Always consult a licensed pharmacist".
42. [ ] Wire "Approve & Save" to call backend `POST /approve`.
43. [ ] Wire "Search Again" to return to `/`.
44. [ ] Implement `/history` with a table of approved reports showing medicine name, date, and severity.
45. [ ] Make `/history` rows expand to show the full approved report.
46. [ ] Ensure the frontend never calls TinyFish or DashScope directly.
47. [ ] Add frontend tests for search submission, review rendering, severity styling, approval, and history display.
48. [ ] Run a browser verification pass for `/`, `/review`, and `/history` at desktop and mobile sizes.

## Milestone 4: Feature 4 - Medicine Locator

49. [ ] Add find_nearby_pharmacies() tool to app/tools.py
50. [ ] Add search_medicine_price_pakistan() tool to app/tools.py
51. [ ] Add GOOGLE_MAPS_API_KEY to .env placeholder
52. [ ] Verify both new tools return correct shapes with unit tests
53. [ ] Create app/locator_agent.py with PharmacyFinderAgent
54. [ ] Create PriceAgent in app/locator_agent.py
55. [ ] Create locator_agent SequentialAgent in app/locator_agent.py
56. [ ] Import locator_agent and create _locator_runner in backend/main.py
57. [ ] Add LocateRequest pydantic model to backend/main.py
58. [ ] Implement POST /locate endpoint in backend/main.py
59. [ ] Smoke test: import locator_agent and backend.main with no errors
60. [ ] Add "Find Near Me" button to frontend/app/review/page.tsx
61. [ ] Add PharmacyResults component to review page
62. [ ] Add EstimatedPrice section to review page
63. [ ] Switch PharmacyFinderAgent and PriceAgent in app/locator_agent.py from `gemini_model()` to `qwen_model()`. Reason: the Gemini free tier returns hard `429 RESOURCE_EXHAUSTED` with `limit: 0` for `gemini-2.0-flash-lite`, which retry logic cannot fix. Qwen/DashScope is the existing model for the main pipeline. Ensure both agents' instructions end with "Respond in JSON format." (already present) and contain no literal `{var}` syntax (ADK treats curly braces as session-state template substitution). Do not change SearchAgent/FetchAgent/SummaryAgent/WarningAgent.
64. [ ] Re-evaluate the retry/503 mitigation loop in `POST /locate` (backend/main.py). With Gemini removed, decide whether to keep the transient-error retry as generic Qwen/DashScope mitigation, narrow its conditions, or remove it. Confirm with maintainer before deleting.

## Milestone 5: Feature 5 - Natural-Language Chat Interface

65. [x] Add `app/app_utils/trace.py` with a `collect_trace(runner, *, user_id, session_id, new_message, run_until_callable=None)` helper that drives the runner, yields a `TraceEvent` dict for each ADK event (seq/ts/event_type/agent_name/label), and returns `(trace, final_event_or_marker)`. The helper must NOT change the runner or agent behavior — it must only observe events and break on the same marker the existing pipeline uses.
66. [x] Add `app/query_parser_agent.py` with a Pydantic `ParsedQuery` schema (medicine_name: str, radius_km: float = 5.0, patient_context: str | None) and a `QueryParserAgent` Agent built with `qwen_model()`, `output_schema=ParsedQuery`, `output_key="parsed_query"`. Instruction must end with "Respond in JSON format." and contain no literal `{var}` syntax. Coordinates are referenced as "provided in the message body" — never interpolated.
67. [x] Verify `QueryParserAgent` in isolation: run it on (a) "find me panadol extra within 5 miles of my location", (b) "tell me about ibuprofen", (c) "brufen 400mg for my elderly mother who is on warfarin" and confirm `medicine_name` / `radius_km` / `patient_context` are extracted correctly (5 miles → ~8.04672 km, no distance → default 5.0 km, patient context captured).
68. [x] Wrap `_runner.run` in `_run_until_pause` (backend/main.py) with `collect_trace` so `POST /search` populates a `trace: [...]` list. Existing response fields and behavior must not change.
69. [x] Wrap `_locator_runner.run` inside `POST /locate` (backend/main.py) with `collect_trace` so `POST /locate` populates a `trace: [...]` list. Existing response fields and behavior must not change.
70. [x] Add a one-shot QueryParser runner in `backend/main.py` (`_query_parser_runner = Runner(agent=query_parser_agent, session_service=_session_service, app_name=APP_NAME)`).
71. [x] Add a `ChatRequest` Pydantic model (`message: str`, `lat: float`, `lng: float`, `session_id: str | None`) to `backend/main.py`.
72. [x] Implement `POST /chat` in `backend/main.py`:
    - Build the QueryParser user message with raw text + `lat=...` / `lng=...` lines appended (no `{var}` interpolation).
    - Run the QueryParserAgent in a fresh session, extract `medicine_name` / `radius_km` / `patient_context` from state, then re-use `_run_until_pause` and the locator block to run the existing pipelines with those values.
    - Convert parsed `radius_km` → meters for `find_nearby_pharmacies`.
    - Return `{"status": "ok", "parsed_query": {...}, "medicine_summary", "warning_assessment", "pharmacies", "price_info", "trace": [...]}`.
    - Wrap in try/except and return `{"status": "error", "message": "..."}` on failure (no stack traces).
73. [x] Confirm existing `POST /search`, `POST /approve`, `POST /locate`, `GET /history` still work end-to-end (no behavior change for callers; only a new `trace` field is added to `/search` and `/locate`).
74. [x] End-to-end verify `POST /chat` with `curl`: send a sample query, confirm `parsed_query.medicine_name` matches, `trace` is a non-empty ordered list, and `medicine_summary` / `warning_assessment` / `pharmacies` / `price_info` are all present.

## Deferred bugs (re-verify once Maps API / DNS connectivity is restored)

75. [ ] **Pharmacies returned as unstructured text in `/chat` and `/locate`.** `PharmacyFinderAgent` does not produce a structured JSON object when `search_places` returns 0 places — it falls back to inline prose with an embedded half-JSON block, which `_coerce_state_json` then surfaces as a string. Cannot be cleanly reproduced or fixed until the Maps API path returns real results (current state: every `search_places` call yields 0 places). When connectivity is restored, re-test with a real pharmacy query and either tighten the agent instruction or short-circuit to an error envelope when the parsed result is not a list of dicts.
76. [ ] **`price_info` extraction returns empty object.** `PriceAgent`'s tool call to `search_medicine_price_pakistan` succeeds (trace shows a real source URL), but the LLM extraction step writes `{"estimated_price_pkr": "", "alternatives": []}`. Cannot be cleanly diagnosed until pharmacies/price is exercised against a working end-to-end locator run; re-verify alongside #75.
