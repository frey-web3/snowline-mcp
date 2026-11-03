import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnowlineClient } from "../client.js";
import { buildEnvelope } from "../envelope.js";
import { RESOURCE_LIMIT, resourceJson } from "./common.js";

export function registerBusinessResources(server: McpServer, client: SnowlineClient): void {
  server.registerResource(
    "businesses",
    "snowline://businesses",
    {
      title: "Tracked Avalanche businesses",
      description:
        "Verified Avalanche ecosystem businesses with classification, market cap, valuation source and official links.",
      mimeType: "application/json",
    },
    async (uri) => {
      const body = await client.request("businesses", { query: { limit: RESOURCE_LIMIT } });
      return resourceJson(uri, buildEnvelope(body, { payloadKey: "businesses", limit: RESOURCE_LIMIT }));
    }
  );
}
