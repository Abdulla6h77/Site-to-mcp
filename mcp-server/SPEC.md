# Site to MCP specification

Source: `D:\tinyfish-details.md`, bounty 8 and its rulebook.

Standalone MCP server in Medicine Autopilot for a real website without a public API. Keep component dependencies, runtime configuration, tests, and run instructions local. Preserve the parent medical pipeline, backend, frontend, database, and agent configuration.

## TinyFish products

**Required: TinyFish Agent and Fetch.** Explain each role and ensure TinyFish performs live work behind every tool.

## Official submission requirements

- **S1** Wraps at least one real website that has no public API
- **S2** Exposes at least three tools (actions) with typed inputs and outputs
- **S3** Works from Claude, ChatGPT or any MCP client: show it being called in a real conversation
- **S4** Includes a test or health check that shows when the site changes and a tool breaks
- **S5** Short explanation of how TinyFish Agent and Fetch are used

## Official approval criteria

- **A1** TinyFish does the real web work behind every tool
- **A2** Tools return clean structured data, not raw page dumps
- **A3** Works for different inputs, not one scripted call
- **A4** Breaks loudly, not silently, when the site changes
- **A5** Not licence checks or property records (those are their own bounties)

## Official judging priorities

- **J1** Tool design: clear names, typed inputs and outputs, and actions an agent actually needs
- **J2** Works in a real agent conversation, including multi-step use of several tools
- **J3** Robustness: errors are clear, and a health check catches when the site changes
- **J4** Value: a useful site with no API that people would want their agent to use
- **J5** Easy to install and call for another developer, with a clear README

## Demo and acceptance tests

Show the server being called in a real conversation from Claude, ChatGPT, or another external MCP client. Demonstrate at least three typed tools across distinct inputs and include a multi-step workflow as judging evidence.

- **A1** Wrap a real site without a public API. Verify that each of at least three tool invocations depends on live TinyFish website work.
- **A2** Define explicit typed inputs and outputs and validate both. Test invalid input and malformed extraction. Return clean structured results.
- **A3** Test several inputs per tool, including empty results, and record a real external-client conversation using multiple tools.
- **A4** Add the project-required health check and verify it reports a changed or broken site contract. Force layout drift in a test and check that both the probe and affected tool surface errors.
- **A5** Choose a useful site and workflows outside licence checks and property records. Confirm site fit before defining the final tool schemas.

## Edge cases and security

Prefer authorized read-only actions. Validate tool arguments, keep destinations constrained to approved origins, treat page content as untrusted, and prevent secrets or raw pages from leaking in errors. Test timeouts, redirects, and layout changes.

Keep credentials, access tokens, and other people's personal data out of the build and demo. Use sanitized fixtures for failure tests and label fixture evidence separately from live evidence.

## Rulebook and submission deadline

- Deadline: Tuesday, November 17, 2026 at 11:59 PM Pacific (Wednesday, November 18 at 12:59 PM Pakistan time).
- Enter through the TinyFish Students or Ambassadors program. One person per build and one entry per person per bounty. Claims do not reserve a bounty, and submissions are final.
- Provide a working build link (repo, live demo, or cookbook PR) with notes on what it does and how TinyFish is used. Post about the build on LinkedIn and tag TinyFish. Share it in Discord #showcase. X is optional.
- Pass every approval criterion. Use original work built for the bounty and demonstrate meaningful live TinyFish work end to end across varied inputs. Keep the submitted evidence authentic.
- The general endpoint rubric awards 50/100/150/200 points for 1/2/3/4+ meaningful endpoints (Search, Fetch, Agent, Browser, Monitor). Each endpoint must contribute to the workflow.

## Open questions and dependencies

Target site and MCP transport are unspecified. The official brief permits a test or health check. The existing project scope requires a health check, so retain it. Confirm the selected site's access rules and the external client's transport support early.

## FDA implementation scope

The standalone source is the current FDA Drug Safety Communications archive. The tools return communication metadata, an announcement excerpt, or warning excerpts. Complete prescribing and patient-specific information remain outside the source scope. The optional ADK adapter and review display are the requested parent-project integration. They retain the existing research, approval, and storage paths.
