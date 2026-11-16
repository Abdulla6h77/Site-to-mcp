# Validation and submission status

## Live evidence

- FDA source qualification succeeded for montelukast and cetirizine. A separate lookup found no matching title for gabapentin in the selected archive.
- A separate MCP SDK client connected over stdio, discovered all four tools and their declared schemas, rejected blank input and an off-site URL, and verified search, detail, and warning responses for montelukast plus search and detail for cetirizine. FDA publication dates were 2020-03-04 and 2025-05-16 respectively.
- The live MCP health check returned healthy with three warning excerpts. Provider run IDs are retained in private local logs.
- Actual tool calls and responses are in `.local/live-verify.jsonl` and `.local/live-health.jsonl`. These ignored local transcripts include only public queries and reference results. Review before sharing.
- A signed-in external Codex CLI conversation completed the three-tool cetirizine chain. The ignored transcript is `.local/codex-night-smoke.jsonl`. Earlier conversations blocked by the exhausted wallet remain in the private logs.
- A live cetirizine run in the app returned HTTP 200, the exact DailyMed label URL, the FDA advisory, and three warning excerpts. The report appeared in pending history, reopened from SQLite, and moved to approved only after explicit approval. This run used a temporary SQLite database.

## Automated and regression checks

- Standalone: 5 tests passed. Includes typed MCP inputs and outputs, provider request shape, no match, off-site and redirect rejection, and fixture cases for malformed layout, timeout and HTTP 402.
- Medicine Autopilot: five targeted Python tests passed. The approval regression verifies incomplete research, exact source propagation, pending history, reopened reports, client replacement rejection, and duplicate approval handling. The frontend TypeScript check passed.
- A mobile browser check with fixture responses exercised search, refresh, history reopening, approval, and a second refresh. It made one search request. Fixture evidence is separate from the live provider results above.

## Submission handoff

Record or share a credential-free external MCP client walkthrough using the three research tools. Include the GitHub build link and complete the bounty's LinkedIn and Discord showcase steps. See [DEMO.md](DEMO.md).
