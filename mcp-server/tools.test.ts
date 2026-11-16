import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { archive, articleUrl, ReferenceError, tinyfish } from "./tinyfish.ts";
import { createActions, createServer } from "./tools.ts";
import type { SourceProvider } from "./tinyfish.ts";

const url = "https://www.fda.gov/drugs/drug-safety-communications/fda-test-advisory";
const article = { url, final_url: url, text: "# FDA communication about sample-medicine\n\n## 3-4-2020 FDA Drug Safety Communication\n\nThe FDA describes a serious risk associated with sample-medicine. This fixture is solely a test of the reference schema.\n\n## Related Information\n\nExcluded." };
const fake: SourceProvider = {
  async search(query) {
    return { runId: "fixture-agent-run", result: { status: query === "sample-medicine" ? "found" : "no_match",
      results: query === "sample-medicine" ? [{ title: "FDA communication about sample-medicine", url, date: "3-4-2020" }] : [] } };
  },
  async fetchArticle() { return article; },
};

test("archive metadata and detail are validated, including dates and source identity", async () => {
  const actions = createActions(fake);
  const search = await actions.search("sample-medicine", 1);
  assert.equal(search.archive_url, archive);
  assert.equal(search.results[0].publication_date, "2020-03-04");
  assert.equal((await actions.search("absent", 1)).status, "no_match");
  const doc = await actions.document("sample-medicine", url);
  assert.equal(doc.source.source_url, url);
  assert.equal(doc.source.publication_date, "2020-03-04");
  assert.equal(actions.warningExcerpts(doc.paragraphs).length, 1);
  await assert.rejects(actions.document("different-medicine", url), { code: "medicine_mismatch" });
});

test("rejects off-origin links, arbitrary pages, credentials, and redirected content", async () => {
  for (const value of [archive, "http://www.fda.gov/drugs/drug-safety-communications/fda-test", "https://example.test/",
    "https://www.fda.gov/admin/user", url + "?track=abc", "https://x@y.fda.gov/"]) assert.throws(() => articleUrl(value));
  const actions = createActions({ ...fake, async fetchArticle() { return { ...article, final_url: url + "-different" }; } });
  await assert.rejects(actions.document("sample-medicine", url), { code: "site_contract" });
});

async function fixtureClient(provider: SourceProvider) {
  const server = createServer(provider);
  const client = new Client({ name: "fixture", version: "1" });
  const [a,b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

test("MCP protocol declares and enforces schemas and serves three distinct reference actions", async t => {
  const c = await fixtureClient(fake);
  t.after(c.close);
  assert.equal((await c.client.listTools()).tools.length, 4);
  const bad = await c.client.callTool({ name: "search_medicines", arguments: { query: "" } });
  assert.equal(bad.isError, true);
  const args = { medicine_name: "sample-medicine", source_url: url };
  for (const [name, toolArgs] of [["search_medicines", {query:"sample-medicine"}],
    ["get_medicine_details", args], ["get_safety_warnings", args], ["check_reference_health", {query:"sample-medicine"}]] as const) {
    const result = await c.client.callTool({name, arguments:toolArgs});
    assert.ok(!result.isError && result.structuredContent, name);
  }
});

test("health distinguishes layout drift from TinyFish timeout", async t => {
  for (const [provider, expected] of [
    [{ ...fake, async fetchArticle() { return {...article, text: article.text.replace("FDA Drug Safety Communication", "Missing heading")}; } }, "site_contract"],
    [{ ...fake, async fetchArticle() { throw new ReferenceError("tinyfish_timeout", "timed out"); } }, "tinyfish_timeout"],
  ] as const) {
    const c = await fixtureClient(provider);
    t.after(c.close);
    const result = await c.client.callTool({ name:"check_reference_health", arguments:{ query:"sample-medicine" } });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result.content), new RegExp(expected));
    assert.match(JSON.stringify(result.content), /advisory retrieval/);
  }
});

test("TinyFish adapter uses the documented endpoints and reports payment and timeout failures", async t => {
  const originalKey = process.env.TINYFISH_API_KEY;
  const originalRateDb = process.env.SITE_MCP_RATE_DB;
  process.env.TINYFISH_API_KEY = "fixture-only-key";
  process.env.SITE_MCP_RATE_DB = ":memory:";
  t.after(() => {
    if (originalKey === undefined) delete process.env.TINYFISH_API_KEY;
    else process.env.TINYFISH_API_KEY = originalKey;
    if (originalRateDb === undefined) delete process.env.SITE_MCP_RATE_DB;
    else process.env.SITE_MCP_RATE_DB = originalRateDb;
  });
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (endpoint: string, init: RequestInit) => {
    calls.push(endpoint);
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "error");
    const body = JSON.parse(init.body as string);
    if (endpoint.endsWith("/automation/run")) {
      assert.equal(body.url, archive);
      assert.match(body.goal, /sample-medicine/);
      if (calls.length === 1) return Response.json({ status: "COMPLETED", run_id: "fixture", result: {} });
      return Response.json({}, { status: 402 });
    }
    assert.deepEqual(body.urls, [url]);
    assert.equal(body.ttl, 0);
    throw new DOMException("timeout", "TimeoutError");
  });
  assert.equal((await tinyfish.search("sample-medicine", 1)).runId, "fixture");
  await assert.rejects(tinyfish.search("sample-medicine", 1), { code: "tinyfish_payment_required" });
  await assert.rejects(tinyfish.fetchArticle(url), { code: "tinyfish_timeout" });
  assert.deepEqual(calls, ["https://agent.tinyfish.ai/v1/automation/run", "https://agent.tinyfish.ai/v1/automation/run", "https://api.fetch.tinyfish.ai"]);
});
