import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnowlineClient } from "../client.js";
import { buildEnvelope } from "../envelope.js";
import { RESOURCE_LIMIT, resourceJson } from "./common.js";

export function registerBuilderResources(server: McpServer, client: SnowlineClient): void {
  server.registerResource(
    "builders",
    "snowline://builders",
    {
      title: "Avalanche ecosystem builders",
      description:
        "Ecosystem builders, founders and contributors, with role, category, verification status and linked accounts.",
      mimeType: "application/json",
    },
    async (uri) => {
      const body = await client.request("users", { query: { limit: RESOURCE_LIMIT } });
      return resourceJson(uri, buildEnvelope(body, { payloadKey: "users", limit: RESOURCE_LIMIT }));
    }
  );
}
