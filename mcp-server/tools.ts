import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { archive, articleUrl, ReferenceError } from "./tinyfish.ts";
import type { SourceProvider } from "./tinyfish.ts";

const medicine = z.string().trim().min(2).max(60)
  // Keep JavaScript Unicode escapes out of JSON Schema for Python MCP clients.
  .refine(value => /^[\p{L}\p{N}][\p{L}\p{N} /.'()+-]*$/u.test(value), "Enter a medicine name only")
  .refine(value => /\p{L}/u.test(value) && value.split(/\s+/).length <= 5, "Enter a medicine name only");
const link = z.url().max(500);
const date = z.string().max(40).nullable();
const retrieved = z.iso.datetime();
const ref = z.object({ title: z.string().min(1).max(350), source_url: link, publication_date: date });
const source = ref.extend({ retrieved_at: retrieved, publisher: z.literal("U.S. Food and Drug Administration") });
const documentInput = z.object({ medicine_name: medicine, source_url: link.describe("Use an article URL from search_medicines") });
const agentResult = z.object({
  status: z.enum(["found", "no_match", "site_unavailable"]),
  results: z.array(z.object({ title: z.string().min(1).max(350), url: link, date })).max(5),
});
const fetchedResult = z.object({
  url: link, final_url: link, text: z.string().min(100).max(350_000),
});
const unavailable = ["complete prescribing information", "patient-specific advice"] as const;

function mentions(text: string, name: string) {
  const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("en-US")
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(" ");
  return (" " + normalize(text) + " ").includes(" " + normalize(name) + " ");
}

function isoDate(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})$/.exec(value.trim());
  const formatted = match ? `${match[3].length === 2 ? "20" + match[3] : match[3]}-${match[1].padStart(2,"0")}-${match[2].padStart(2,"0")}` : value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(formatted)) return null;
  const stamp = new Date(formatted + "T00:00:00Z");
  return Number.isFinite(+stamp) && stamp.toISOString().slice(0,10) === formatted ? formatted : null;
}

function excerpt(text: string) {
  const plain = text.replace(/\s+/g, " ").trim();
  if (plain.length <= 460) return plain;
  const end = plain.lastIndexOf(". ", 455);
  return end >= 100 ? plain.slice(0,end + 1) : plain.slice(0,455).trimEnd() + "…";
}

export function createActions(provider: SourceProvider) {
  async function search(query: string, limit: number) {
    const { result, runId } = await provider.search(query, limit);
    const checked = agentResult.safeParse(result);
    if (!checked.success) throw new ReferenceError("site_contract", "FDA archive result shape changed; inspect the current archive table.");
    if (checked.data.status === "site_unavailable") throw new ReferenceError("site_unavailable", "FDA archive table was unavailable to TinyFish Agent.");
    const results = new Map<string, z.infer<typeof ref>>();
    for (const row of checked.data.results) {
      if (!mentions(row.title, query)) throw new ReferenceError("site_contract", "An archive row did not match the requested medicine.");
      const url = articleUrl(row.url);
      results.set(url, { title: row.title, source_url: url, publication_date: isoDate(row.date) });
    }
    if ((checked.data.status === "found") !== Boolean(results.size)) {
      throw new ReferenceError("site_contract", "FDA archive status and result rows disagreed.");
    }
    return { status: checked.data.status, query, archive_url: archive, retrieved_at: new Date().toISOString(),
      agent_run_id: runId, results: [...results.values()].slice(0, limit) };
  }

  async function document(name: string, inputUrl: string) {
    const url = articleUrl(inputUrl);
    const data = fetchedResult.safeParse(await provider.fetchArticle(url));
    if (!data.success) throw new ReferenceError("site_contract", "FDA advisory text or source metadata is missing.");
    const canonical = articleUrl(data.data.final_url);
    if (articleUrl(data.data.url) !== url || canonical !== url) {
      throw new ReferenceError("site_contract", "FDA returned a different article. Run search_medicines again.");
    }
    const text = data.data.text;
    const title = text.match(/^#\s+([^\n]+)$/m)?.[1]?.trim();
    if (!title || title.length > 350) throw new ReferenceError("site_contract", "FDA article title is missing.");
    if (!mentions(title, name)) throw new ReferenceError("medicine_mismatch", "The FDA article title does not identify that medicine.");
    const heading = /^#{2,4}\s+(.*?FDA Drug Safety Communication|Safety Announcement)\s*$/im.exec(text);
    if (!heading) throw new ReferenceError("site_contract", "FDA advisory section is missing. Inspect the current article layout.");
    const start = heading.index + heading[0].length;
    const end = text.slice(start).search(/^#{2,3}\s+(?:Related Information|Contact FDA|References|Content current as of)/im);
    const body = text.slice(start, end < 0 ? undefined : start + end);
    const paragraphs = body.split(/\r?\n\s*\r?\n/).map(block => block.trim())
      .filter(block => block.length >= 40 && !/^#|^\[|^Drug Safety Communication\s*\(/i.test(block));
    if (!paragraphs.length) throw new ReferenceError("site_contract", "FDA advisory contains no usable announcement text.");
    const headingDate = heading[1].match(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/)?.[0];
    return { paragraphs, source: { title, source_url: canonical, publication_date: isoDate(headingDate ?? null),
      retrieved_at: new Date().toISOString(), publisher: "U.S. Food and Drug Administration" as const } };
  }

  function warningExcerpts(paragraphs: string[]) {
    return paragraphs.filter(paragraph => /\b(?:warn\w*|risks?|precautions?|serious|side effects?|interact\w*)\b/i.test(paragraph))
      .slice(0, 3).map(excerpt);
  }
  return { search, document, warningExcerpts };
}

export function createServer(provider: SourceProvider) {
  const server = new McpServer({ name: "FDA Medicine Reference", version: "1.0.0" });
  const actions = createActions(provider);
  const success = (structuredContent: Record<string, unknown>) => ({
    structuredContent, content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
  });
  const failure = (error: unknown) => {
    const safe = error instanceof ReferenceError ? { code: error.code, message: error.message }
      : { code: "internal", message: "The MCP server could not complete this request. Check the local configuration." };
    return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(safe) }] };
  };
  const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

  server.registerTool("search_medicines", {
    description: "Find medicine-name mentions in the current FDA Drug Safety Communications archive. No match does not establish safety.",
    inputSchema: z.object({ query: medicine, limit: z.number().int().min(1).max(5).optional() }),
    outputSchema: z.object({ status: z.enum(["found", "no_match"]), query: medicine, archive_url: link,
      retrieved_at: retrieved, agent_run_id: z.string().min(1), results: z.array(ref).max(5) }),
    annotations,
  }, async ({ query, limit }) => {
    try { return success(await actions.search(query, limit ?? 3)); } catch (error) { return failure(error); }
  });

  server.registerTool("get_medicine_details", {
    description: "Retrieve one selected, dated FDA advisory and its announcement excerpt. This is a reference document, not a drug monograph.",
    inputSchema: documentInput, outputSchema: z.object({
      medicine_name: medicine, source, announcement_excerpt: z.string().min(1).max(460), unavailable_fields: z.array(z.string()),
    }), annotations,
  }, async ({ medicine_name, source_url }) => {
    try {
      const result = await actions.document(medicine_name, source_url);
      return success({ medicine_name, source: result.source, announcement_excerpt: excerpt(result.paragraphs[0]),
        unavailable_fields: [...unavailable, "complete list of uses, forms, doses and side effects"] });
    } catch (error) { return failure(error); }
  });

  server.registerTool("get_safety_warnings", {
    description: "Read the selected FDA advisory and return bounded, verbatim risk passages. Use the full source for context.",
    inputSchema: documentInput, outputSchema: z.object({
      medicine_name: medicine, source, status: z.enum(["available", "not_reported"]),
      warning_excerpts: z.array(z.string().max(460)).max(3), unavailable_fields: z.array(z.string()),
    }), annotations,
  }, async ({ medicine_name, source_url }) => {
    try {
      const result = await actions.document(medicine_name, source_url);
      const warnings = actions.warningExcerpts(result.paragraphs);
      return success({ medicine_name, source: result.source, status: warnings.length ? "available" : "not_reported",
        warning_excerpts: warnings, unavailable_fields: [...unavailable, "complete contraindications and interactions"] });
    } catch (error) { return failure(error); }
  });

  server.registerTool("check_reference_health", {
    description: "Run a live search and verify that the FDA advisory title, announcement, and warning extraction still work.",
    inputSchema: z.object({ query: medicine }),
    outputSchema: z.object({ status: z.literal("healthy"), source, agent_run_id: z.string(), warning_count: z.number().int().positive() }),
    annotations,
  }, async ({ query }) => {
    let stage = "archive lookup";
    try {
      const result = await actions.search(query, 1);
      if (!result.results.length) throw new ReferenceError("no_match", "Use a known archive medicine as the health canary.");
      stage = "advisory retrieval and field validation";
      const doc = await actions.document(query, result.results[0].source_url);
      const warnings = actions.warningExcerpts(doc.paragraphs);
      if (!warnings.length) throw new ReferenceError("site_contract", "Canary warning section is empty; inspect the FDA page structure.");
      return success({ status: "healthy", source: doc.source, agent_run_id: result.agent_run_id, warning_count: warnings.length });
    } catch (error) {
      return failure(error instanceof ReferenceError ? new ReferenceError(error.code, `${stage}: ${error.message}`) : error);
    }
  });
  return server;
}
