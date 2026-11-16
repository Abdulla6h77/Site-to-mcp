# Two-minute demo

Record a genuine run. Trim waiting time in the edit and disclose that the FDA pacing makes the actual run longer.

1. **0:00–0:20** Show the MCP startup command and the external client's discovered tools. Keep terminal credential setup out of the recording.
2. **0:20–0:55** Ask the external client for an FDA advisory for cetirizine. Show search followed by detail and warning calls using the exact returned URL. Show the official source link, publication date, and retrieval time.
3. **0:55–1:10** Show a blank input or an unrelated URL rejected. If demonstrating a no-match case, explain the scope of the FDA archive.
4. **1:10–1:45** Run Medicine Autopilot with an enabled FDA reference agent and a medicine name only. Show the FDA advisory and patient-context sections separately. Show that the review asks for approval and history has no new entry before approval.
5. **1:45–2:00** Show the health check and explain why Agent handles archive navigation while Fetch validates the article and provides the excerpts.

## Recording checklist

- Tool discovery shows declared input and output schemas.
- External conversation includes actual MCP tool calls, a real source link, and a final reply grounded in those calls.
- Evidence includes two different medicine names and a failure case.
- UI footage shows the actual FastAPI response and human-review checkpoint.
- No credentials, dashboard authentication, patient details, or unrelated personal data are visible.
- Provide a working build link and TinyFish usage notes. The bounty also calls for a LinkedIn post tagging TinyFish and a Discord #showcase share.
