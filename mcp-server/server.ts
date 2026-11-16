import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { tinyfish } from "./tinyfish.ts";
import { createServer } from "./tools.ts";

await createServer(tinyfish).connect(new StdioServerTransport());
