# Site to MCP tasks

Criterion and requirement IDs refer to [SPEC.md](SPEC.md). This checklist plans implementation and validation.

## Prerequisites

- [x] Record the official submission requirements, approval criteria, and judging priorities.
- [x] Confirm the source, product access, and endpoint contracts with live Agent and Fetch qualification.
- [ ] Restore sufficient TinyFish Agent and DashScope quota for final live verification.
- [x] Keep the standalone setup and dependencies project-local. Limit parent changes to the requested adapter and UI integration.

## Implementation and approval checks

- [x] **A1** Wrap a real site without a public API. Verify that each of at least three tool invocations depends on live TinyFish website work.
- [x] **A2** Define explicit typed inputs and outputs and validate both. Test invalid input and malformed extraction. Return clean structured results.
- [ ] **A3** Test several inputs per tool, including empty results, and record a real external-client conversation using multiple tools.
- [x] **A4** Add the project-required health check and verify it reports a changed or broken site contract. Force layout drift in a test and check that both the probe and affected tool surface errors.
- [x] **A5** Choose a useful site and workflows outside licence checks and property records. Confirm site fit before defining the final tool schemas.

## Integration verification

- [x] Verify standalone stdio calls for both medicines and a live contract health check.
- [x] Test ADK state handling, explicit FDA lookup errors, and the approval gate with fixtures.
- [ ] Complete a live Medicine Autopilot review through the existing Qwen pipeline.
- [ ] Complete the three-tool conversation in a real external MCP host. See [VALIDATION.md](VALIDATION.md).

## Demo and submission

- [ ] Show the server being called in a real conversation from Claude, ChatGPT, or another external MCP client. Demonstrate at least three typed tools across distinct inputs and include a multi-step workflow as judging evidence.
- [ ] Run the edge-case and security checks in SPEC.md. Capture reproducible live evidence separately from fixture results.
- [ ] Review every submission requirement (S1, S2, S3, S4, S5) and approval criterion before marking the build ready.
- [ ] Prepare setup instructions, the working build link, notes explaining TinyFish's role, the required LinkedIn post tagging TinyFish, and the Discord #showcase share. Obtain publication authorization before posting.
- [ ] Verify the evidence and submit by Tuesday, November 17, 2026 at 11:59 PM Pacific (Wednesday, November 18 at 12:59 PM Pakistan time).
