import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnowlineClient } from "../client.js";
import { buildEnvelope } from "../envelope.js";
import { RESOURCE_LIMIT, resourceJson } from "./common.js";

/**
 * Network-level resources: the L1 directory, the chain-stats snapshot and the
 * latest intel feed.
 *
 * There is no `snowline://validators` resource. Snowline publishes no
 * validators route, and inventing a URI that cannot be read is worse than
 * omitting it; validator counts are part of `snowline://network/stats`.
 */
export function registerNetworkResources(server: McpServer, client: SnowlineClient): void {
  server.registerResource(
    "chains",
    "snowline://chains",
    {
      title: "Avalanche L1 chains",
      description:
        "Mainnet Avalanche L1 chains with live telemetry: latest block, 24h transactions, TPS, active addresses, fees, RPC and explorer URL.",
      mimeType: "application/json",
    },
    async (uri) => {
      const body = await client.request("l1Chains", { query: { limit: RESOURCE_LIMIT } });
      return resourceJson(uri, buildEnvelope(body, { limit: RESOURCE_LIMIT }));
    }
  );

  server.registerResource(
    "network-stats",
    "snowline://network/stats",
    {
      title: "Avalanche network stats",
      description:
        "Latest C-Chain snapshot: block height, transactions, TPS, active addresses, validator count, gas, fees, supply and staking.",
      mimeType: "application/json",
    },
    async (uri) => {
      const body = await client.request("stats");
      return resourceJson(uri, buildEnvelope(body));
    }
  );

  server.registerResource(
    "latest-intel",
    "snowline://intel/latest",
    {
      title: "Latest Snowline intel",
      description:
        "Most recent builder and company updates: milestones, product launches, network upgrades, with publication dates and source links.",
      mimeType: "application/json",
    },
    async (uri) => {
      const body = await client.request("updates", { query: { limit: RESOURCE_LIMIT } });
      return resourceJson(uri, buildEnvelope(body, { payloadKey: "updates", limit: RESOURCE_LIMIT }));
    }
  );
}
