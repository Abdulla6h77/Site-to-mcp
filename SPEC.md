# medicine-autopilot — Feature Specification

> The sections below document the original prototype. The current submission uses medicine search, persistent research history, and explicit approval. Chat, pharmacy location, and price lookup were retired. See [README.md](README.md) and the standalone [Site to MCP specification](mcp-server/SPEC.md).

## Project
Track 4 Autopilot Agent — Qwen Cloud Global AI Hackathon
Stack: Google ADK + Qwen (via LiteLLM/DashScope) + TinyFish + Next.js

---

## Feature 1: Agent Pipeline (backend) ← CURRENT FOCUS

### Input
- `medicine_name: str` — required
- `patient_context: str` — optional (age, allergies, current meds)

### Pipeline Steps (Sequential, must run in order)
1. SearchAgent — calls `search_medicine(medicine_name)` via TinyFish Search API
   - Returns top 5 URLs + snippets
   - On failure: returns error dict, pipeline continues with fallback message

2. FetchAgent — calls `fetch_top_result(search_results)` via TinyFish Fetch API
   - Fetches content from first URL in search results
   - Trims content to 5000 chars max
   - On failure: returns error dict, pipeline continues

3. SummaryAgent — Qwen structures fetched content into MedicineSummary schema:
   - generic_name: str
   - brand_names: list[str]
   - uses: list[str]
   - dosage: str
   - side_effects: list[str]
   - warnings: list[str]
   - interactions: list[str]

4. WarningAgent — Qwen checks MedicineSummary against patient_context:
   - Returns WarningAssessment schema:
     - red_flags: list[str]
     - interactions: list[str]
     - pregnancy_risk: str | None
     - age_risk: str | None
     - severity: "low" | "medium" | "high"

5. HumanReviewCheckpoint — MANDATORY PAUSE
   - Uses ADK request_input()
   - Pipeline halts, returns full report to caller
   - Nothing is saved until human explicitly approves
   - Session state preserved via ResumabilityConfig

### Output (returned to frontend at pause)
```json
{
  "session_id": "...",
  "medicine_summary": { ...MedicineSummary },
  "warning_assessment": { ...WarningAssessment },
  "sources": ["url1", "url2"],
  "status": "awaiting_human_review"
}
```

---

## Feature 2: FastAPI Server

### Endpoints
- `POST /search` — triggers pipeline, returns report + session_id
- `POST /approve` — resumes session, saves report to SQLite
- `GET /history` — returns list of approved reports

### Error handling
- All endpoints return `{"status": "error", "message": "..."}` on failure
- Never expose stack traces to frontend

---

## Feature 3: Next.js Frontend

### Page 1: `/` (Search)
- Input: medicine name (required)
- Textarea: patient context (optional)
- Button: "Run Pipeline" → calls POST /search
- Loading state: shows pipeline step progress
- On success: redirects to /review

### Page 2: `/review` (Human Checkpoint)
- Displays full MedicineSummary in structured cards
- Displays WarningAssessment with color-coded severity
  - high → red banner
  - medium → orange banner
  - low → green banner
- Source URLs listed at bottom
- Two buttons:
  - "Approve & Save" → calls POST /approve
  - "Search Again" → back to /
- Disclaimer banner: "Always consult a licensed pharmacist"

### Page 3: `/history`
- Table of approved reports
- Columns: medicine name, date, severity
- Click row → expands full report

---

## Constraints
- No API keys or secrets in code — env vars only
- Tools never raise exceptions — always return error dicts
- Frontend never calls TinyFish or DashScope directly
- SQLite for local dev; swap to ApsaraDB for Alibaba Cloud deployment
- All Qwen calls go through DashScope international endpoint

---

## Feature 4: Medicine Locator

### New Endpoint
POST /locate
  Input:  { "medicine_name": str, "lat": float, "lng": float }
  Output: {
    "status": "success",
    "pharmacies": [
      {
        "name": str,
        "address": str,
        "rating": float | null,
        "open_now": bool | null,
        "lat": float,
        "lng": float,
        "place_id": str,
        "maps_link": "https://maps.google.com/?q={lat},{lng}"
      }
    ],
    "price_info": {
      "source": str,
      "estimated_price_pkr": str,
      "alternatives": list[str],
      "raw": str
    }
  }
  On error: { "status": "error", "message": "..." }
  Never expose stack traces.

### New Tools (app/tools.py)
1. find_nearby_pharmacies(lat: float, lng: float, radius_meters: int = 2000) -> dict
   - Calls Google Maps Places API nearbysearch
   - type: "pharmacy"
   - Returns top 5 results with name, address, rating,
     open_now, place_id, lat, lng, maps_link
   - Reads GOOGLE_MAPS_API_KEY from env
   - On failure returns {"status": "error", "message": "..."}
   - Never raises exceptions

2. search_medicine_price_pakistan(medicine_name: str) -> dict
   - Uses existing search_medicine() to query:
     "{medicine_name} price Pakistan"
   - Fetches top result using existing fetch_top_result()
   - Returns {"status": "success", "source": url, "price_info": str (max 3000 chars)}
   - On failure returns {"status": "error", "message": "..."}
   - Never raises exceptions

### New File: app/locator_agent.py
- PharmacyFinderAgent: LLM agent using find_nearby_pharmacies tool
  instruction: find pharmacies near lat/lng, return structured list
  output_key: "nearby_pharmacies"

- PriceAgent: LLM agent using search_medicine_price_pakistan tool
  instruction: find medicine price in Pakistan, extract
  estimated_price_pkr and alternatives list
  output_key: "price_info"

- locator_agent: SequentialAgent([PharmacyFinderAgent, PriceAgent])

Both sub-agents use qwen_model() from app/agent.py.
Both sub-agent instructions end with "Respond in JSON format."

### New Runner in backend/main.py
- Import locator_agent from app/locator_agent.py
- Create _locator_runner = Runner(agent=locator_agent,
  session_service=_session_service, app_name=APP_NAME)
- Add LocateRequest pydantic model
- Add POST /locate endpoint following same pattern as POST /search:
  - create session
  - run pipeline
  - extract state keys "nearby_pharmacies" and "price_info"
  - return combined response
  - wrap in try/except, return error envelope on failure

### Frontend changes (frontend/app/review/page.tsx)
Add below the Warning Assessment section:

"Find Near Me" button:
- Calls navigator.geolocation.getCurrentPosition()
- On permission denied: shows inline error "Location access denied"
- On success: POSTs to http://localhost:8000/locate with
  {medicine_name, lat, lng}
- Loading state: "📍 Finding nearby pharmacies..."
- On success: shows PharmacyResults section

PharmacyResults section:
- Heading: "Nearby Pharmacies"
- For each pharmacy: card showing
  - Name (bold)
  - Address
  - Rating (stars if available)
  - Open now: green "Open" or red "Closed" badge
  - "Get Directions" link → opens https://maps.google.com/?q={lat},{lng}
    in new tab
- Below pharmacies: "Estimated Price" section
  - Shows estimated_price_pkr if found
  - Shows alternatives list if found
  - Source link

### New env var
GOOGLE_MAPS_API_KEY=your-key-here
(read via os.getenv("GOOGLE_MAPS_API_KEY") — never hardcoded)

### Constraints
- Frontend never calls Google Maps API directly
- All Google Maps calls go through backend /locate endpoint
- GOOGLE_MAPS_API_KEY never exposed to frontend
- All new tools follow same error handling pattern as existing tools
- All new agent instructions end with "Respond in JSON format."

### Model assignment strategy (Feature 4)
- `PharmacyFinderAgent` and `PriceAgent` MUST use `qwen_model()` (DashScope/Qwen via LiteLLM). `gemini_model()` is NOT used by Feature 4 agents.
- Rationale: Gemini free tier returns a hard `429 RESOURCE_EXHAUSTED` with `limit: 0` for `gemini-2.0-flash-lite`, which retry logic cannot recover from. All Qwen calls already route through the DashScope international endpoint for the main pipeline, so the same model is reused here for consistency.
- Qwen/DashScope requires the literal word `json` somewhere in the prompt when `response_format: json_object` is used. All agent instructions for Feature 4 MUST therefore end with the exact sentence: `Respond in JSON format.`
- Instructions MUST NOT contain literal `{variable_name}` syntax. ADK treats curly braces as session-state template substitution and raises `KeyError` for any unresolved token. Instructions refer to coordinates as "provided in the message body" instead.
- The `POST /locate` retry/503 mitigation is generic and applies to whatever provider the agents route through (currently Qwen/DashScope). It is not Gemini-specific.

---

## Feature 5: Natural-Language Chat Interface

Adds a chat-style query layer to the backend so a future frontend can send a single natural-language message and get a structured result back, with an ordered trace of what the agents did.

### New Agent: QueryParserAgent (app/query_parser_agent.py)
- Single LLM agent, uses `qwen_model()` (consistent with `SearchAgent`/`FetchAgent`/`SummaryAgent`/`WarningAgent`/`PharmacyFinderAgent`/`PriceAgent`).
- Input message format: a serialized user message built in `backend/main.py` that includes the raw natural-language query, plus the user's `lat` and `lng` as separate values. The user message body explicitly notes that coordinates are provided in the message body. The instruction does NOT interpolate `{lat}` / `{lng}` literals.
- Output schema (Pydantic, mirrors `MedicineSummary` / `WarningAssessment` pattern):
  - `medicine_name: str` — required, extracted from the query.
  - `radius_km: float` — defaults to 5.0 if the user did not mention a distance. If the user said miles, convert (1 mile = 1.609344 km).
  - `patient_context: str | None` — any relevant patient details mentioned (e.g. "for my elderly mother"). Null if none.
- Instruction must end with the exact sentence `Respond in JSON format.` (Qwen/DashScope requirement).
- Instruction must not contain literal `{variable_name}` syntax.

### Trace Capture (no streaming, just a collected list)
- The main pipeline (`POST /search` runner) and the locator pipeline (`POST /locate` runner) each yield an ordered list of ADK `Event` objects. We collect a trace alongside the existing flow — pipeline behavior is unchanged.
- Trace shape: an ordered list of `dict` entries, one per event, with at minimum:
  - `seq: int` — sequence number, starts at 1, increments per event.
  - `ts: str` — ISO 8601 UTC timestamp captured at event yield time.
  - `event_type: str` — one of `agent_start`, `tool_call`, `tool_result`, `agent_thinking`, `agent_output`, `agent_end`, `request_input`, `error`.
  - `agent_name: str` — `event.author` (e.g. `SearchAgent`, `PharmacyFinderAgent`).
  - `label: str` — short human-readable summary. For tool calls: a description of which tool is being called and the medicine/location subject (e.g. `Calling TinyFish Search for "Panadol Extra"`). For tool results: a short result summary (e.g. `Fetched 2,341 chars from the top search result`). For agent output: the first 120 chars of the final text. Never include raw payloads.
- Trace capture lives in `app/app_utils/trace.py` (`collect_trace(runner, ...)` helper) so it can be reused by `/search`, `/locate`, and `/chat` without duplicating logic.
- `POST /search` and `POST /locate` responses gain a `trace: [...]` field. Existing fields are unchanged.

### New Endpoint: POST /chat
- Request:
  ```json
  {
    "message": "find me panadol extra within 5 miles of my location",
    "lat": 24.8607,
    "lng": 67.0011,
    "session_id": "optional-existing-session-id"
  }
  ```
- Behavior:
  1. Build a `QueryParserAgent` user message with the raw text + the lat/lng values explicitly appended.
  2. Run `QueryParserAgent` (its own one-shot session). Extract `{medicine_name, radius_km, patient_context}`.
  3. Run the existing main pipeline (search → fetch → summary → warning → human-review checkpoint) with the parsed `medicine_name` and `patient_context`. Capture a trace.
  4. Run the existing locator pipeline with the parsed `medicine_name`, `lat`, `lng`, and the parsed `radius_km` (converted to meters for `find_nearby_pharmacies`). Capture a trace.
  5. Concatenate the two traces into a single ordered list and return.
- Response:
  ```json
  {
    "status": "ok",
    "parsed_query": {
      "medicine_name": "Panadol Extra",
      "radius_km": 8.04672,
      "patient_context": null
    },
    "medicine_summary": { ... },
    "warning_assessment": { ... },
    "pharmacies": [ ... ],
    "price_info": { ... },
    "trace": [
      { "seq": 1, "ts": "...", "event_type": "agent_start", "agent_name": "QueryParserAgent", "label": "..." },
      ...
    ]
  }
  ```
- On any error, return `{"status": "error", "message": "..."}` (no stack traces). Never expose DashScope / TinyFish / Google Maps keys.

### Backward Compatibility
- `POST /search`, `POST /approve`, `POST /locate`, `GET /history` keep their existing request/response contracts. The only addition is a new top-level `trace: [...]` field on `/search` and `/locate`. Existing fields are not renamed, not reordered in a way that breaks consumers, and not removed.
- Trace collection is purely additive — the existing pipeline logic and the existing agent behavior are not modified.

### Constraints (Feature 5)
- All Qwen calls keep going through `qwen_model()` (DashScope international).
- `QueryParserAgent` instruction must end with `Respond in JSON format.`.
- `QueryParserAgent` instruction must not contain literal `{variable_name}` syntax.
- Lat/lng are passed as separate values, never interpolated into instruction strings.
- `radius_km` → meters conversion uses 1 km = 1000 m exactly.
- Miles → km conversion uses 1 mile = 1.609344 km.
- Default `radius_km` is 5.0 when the user did not mention a distance.
- Trace entries do not include raw tool payloads (only short human-readable summaries).
- Error envelope is `{"status": "error", "message": "..."}`; no stack traces exposed.
