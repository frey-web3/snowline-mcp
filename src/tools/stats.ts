import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnowlineClient } from "../client.js";
import { buildEnvelope } from "../envelope.js";
import { READ_ONLY } from "./common.js";
import { fail, ok, summarize } from "./respond.js";

/**
 * The chain-stats snapshot: one call, every headline network figure.
 *
 * There is deliberately no separate validators tool. Snowline publishes no
 * validators route (every candidate 404s); the only validator datum exposed is
 * `validatorCount`, which this snapshot already carries.
 */
export function registerNetworkStats(server: McpServer, client: SnowlineClient): void {
  server.registerTool(
    "snowline_local_network_stats",
    {
      title: "Snowline network stats",
      description:
        "Latest Avalanche C-Chain network snapshot. Includes `latestBlock`, `txCount24h`, `txCountAllTime`, " +
        "`tps`/`avgTps24h`/`maxTps24h`, `activeAddresses24h` (reported as `ecosystemActiveWallets`), `validatorCount`, " +
        "`gasPriceGwei`, `avgTxFeeUsd`, `feesPaid24h`, `totalSupply`, `circulatingSupply`, `totalBurned`, `totalStaked`, " +
        "`contracts24h`, `deployers24h` and `priceUsd`. " +
        "Check `meta.stale` and `meta.asOf` before presenting any figure as current — Snowline flags snapshots it has " +
        "not refreshed. For validator detail beyond the count, use `snowline_local_chains` and the staking metrics from " +
        "`snowline_local_metrics`.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      try {
        const body = await client.request("stats");
        const envelope = buildEnvelope(body);
        return ok(envelope, summarize(envelope, "network snapshot"));
      } catch (error) {
        return fail(error);
      }
    }
  );
}
