import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnowlineClient } from "../client.js";
import { buildEnvelope } from "../envelope.js";
import { RESOURCE_LIMIT, resourceJson } from "./common.js";

export function registerProjectResources(server: McpServer, client: SnowlineClient): void {
  server.registerResource(
    "projects",
    "snowline://projects",
    {
      title: "Avalanche ecosystem projects",
      description:
        "Projects and dApps tracked by Snowline, with category, verification status and live price fields where available.",
      mimeType: "application/json",
    },
    async (uri) => {
      const body = await client.request("projects", { query: { limit: RESOURCE_LIMIT } });
      return resourceJson(uri, buildEnvelope(body, { payloadKey: "projects", limit: RESOURCE_LIMIT }));
    }
  );

  server.registerResource(
    "tokens",
    "snowline://tokens",
    {
      title: "Trending Avalanche tokens",
      description:
        "Trending Avalanche tokens with live market data (price, 24h change, liquidity, market cap) from DexScreener.",
      mimeType: "application/json",
    },
    async (uri) => {
      const body = await client.request("tokens");
      return resourceJson(uri, buildEnvelope(body, { payloadKey: "tokens", limit: RESOURCE_LIMIT }));
    }
  );
}
