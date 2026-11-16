import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const key = process.env.TINYFISH_API_KEY;
if (!key) throw new Error("Set TINYFISH_API_KEY before live verification.");
const env = { TINYFISH_API_KEY: key, ...(process.env.SITE_MCP_RATE_DB ? { SITE_MCP_RATE_DB: process.env.SITE_MCP_RATE_DB } : {}) };
const transport = new StdioClientTransport({
  command: process.execPath, args: [fileURLToPath(new URL("./server.ts", import.meta.url))], env,
});
const client = new Client({ name: "Standalone FDA reference verifier", version: "1.0.0" });
await client.connect(transport);

async function tool(name: string, args: Record<string, unknown>, expectError = false) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 });
  if (Boolean(result.isError) !== expectError) throw new Error(name + " returned an unexpected status: " + JSON.stringify(result.content));
  console.log(JSON.stringify({ tool: name, arguments: args, result }));
  return result.structuredContent as Record<string, unknown>;
}

try {
  const discovered = (await client.listTools()).tools;
  assert.equal(discovered.length, 4);
  assert.ok(discovered.every(t => t.inputSchema && t.outputSchema));
  console.log(JSON.stringify({ discovered: discovered.map(t => t.name) }));
  if (process.argv[2] === "health") {
    await tool("check_reference_health", { query: process.argv[3] || "montelukast" });
  } else {
    await tool("search_medicines", { query: "  " }, true);
    await tool("get_medicine_details", { medicine_name: "montelukast", source_url: "https://example.org/invalid" }, true);
    const search = await tool("search_medicines", { query: "montelukast", limit: 1 });
    assert.equal(search.status, "found");
    const match = (search.results as Array<{source_url: string}>)[0];
    const args = { medicine_name: "montelukast", source_url: match.source_url };
    const detail = await tool("get_medicine_details", args);
    assert.ok(detail.announcement_excerpt);
    const safety = await tool("get_safety_warnings", args);
    assert.equal(safety.status, "available");
    const other = await tool("search_medicines", { query: "cetirizine", limit: 1 });
    assert.equal(other.status, "found");
    const second = (other.results as Array<{source_url: string}>)[0];
    assert.notEqual(second.source_url, match.source_url);
    await tool("get_medicine_details", { medicine_name: "cetirizine", source_url: second.source_url });
  }
} finally { await client.close(); }
