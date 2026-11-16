# medicine-autopilot

Track 4 hackathon prototype ADK agent scaffolded with `agents-cli` 0.5.0.

The agent accepts a medicine name plus optional patient context, researches the medicine through TinyFish, structures medication information, flags patient specific red flags, and then pauses for mandatory human review before anything is saved.

## Pipeline

1. With `MEDICINE_MCP_ENABLED=true`, the FDA reference agent starts the standalone MCP server on demand and looks for published FDA Drug Safety Communications. See [Site to MCP](mcp-server/README.md).
2. `SearchAgent` finds DailyMed label candidates using TinyFish Search.
3. `FetchAgent` reads the selected DailyMed label with TinyFish Fetch.
4. `SummaryAgent` structures the fetched content into `generic_name`, `brand_names`, `uses`, `dosage`, `side_effects`, `warnings`, and `interactions`.
5. `WarningAgent` checks the structured summary against patient context and flags red-flag contraindications.
6. FastAPI validates the research result and prepares it for human review. Approving saves the server-side report without another model call.

## Project Structure

```text
medicine-autopilot/
|-- app/
|   |-- agent.py
|   `-- tools.py
|-- frontend/
|   `-- README.md
|-- .env
|-- agents-cli-manifest.yaml
|-- pyproject.toml
`-- README.md
```

## Model

The LLM agents use Qwen through LiteLLM:

```python
model="dashscope/qwen-plus"
```

Set these values in `.env`:

```env
QWEN_MODEL=dashscope/qwen-plus
DASHSCOPE_API_KEY=...
DASHSCOPE_API_BASE=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
TINYFISH_API_KEY=...
TINYFISH_SEARCH_URL=https://api.tinyfish.ai/v1/search
TINYFISH_FETCH_URL=https://api.tinyfish.ai/v1/fetch
```

## Setup

```bash
agents-cli install
```

Run the local ADK playground:

```bash
agents-cli playground
```

Or do a one-off smoke run:

```bash
agents-cli run "Medicine: ibuprofen. Patient context: 68 years old, warfarin, chronic kidney disease."
```

## Notes

- This is a prototype scaffold. Google Cloud deployment, Terraform, and CI/CD were intentionally skipped.
- The Next.js home page accepts a medicine name and shows a source-linked report for review. It requests no location or patient information.
- The TinyFish endpoints are environment configurable because API base paths can vary between hackathon environments.
- This agent is informational only and must not be used as clinical advice.

## Run the web app

Install the project dependencies and the standalone MCP dependencies first. Start the backend from the repository root with your configured DashScope model and TinyFish key.

```powershell
$env:MEDICINE_MCP_ENABLED = "true"
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

In a second terminal, run these commands from the repository root.

```powershell
cd frontend
npm.cmd run dev -- --webpack
```

Open http://localhost:3000 and try a medicine name such as `cetirizine`. Review the DailyMed label and the separate FDA advisory before choosing whether to save. The browser reads `NEXT_PUBLIC_API_BASE` when configured and otherwise uses `http://localhost:8000`.

## Research history

Completed searches are stored as pending reports in SQLite and appear in Research history. Open a report to review its sources. Approval moves it into the approved collection in a single transaction. A report can be reopened after a refresh or backend restart without contacting TinyFish or DashScope again.

The default database is `db/reports.db` in this checkout. If you set `DB_PATH`, keep using that same path to see the same history. For the local demo, bind the API to loopback. The prototype does not provide user accounts or shared-access controls.

The current web flow is medicine search, source review, and history. The old chat, location, and pharmacy-price flows are retired. See [Site to MCP demo and client setup](mcp-server/README.md) for the standalone bounty walkthrough.
