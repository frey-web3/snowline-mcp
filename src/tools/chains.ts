import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SnowlineClient } from "../client.js";
import { buildEnvelope } from "../envelope.js";
import {
  READ_ONLY,
  clampLimit,
  filterByQuery,
  limitSchema,
  markClientSideFiltered,
  pickArray,
  strField,
  trim,
} from "./common.js";
import { fail, ok, summarize } from "./respond.js";

export function registerChains(server: McpServer, client: SnowlineClient): void {
  server.registerTool(
    "snowline_local_chains",
    {
      title: "Snowline Avalanche L1 chains",
      description:
        "Mainnet Avalanche L1 (subnet) chains with live per-chain telemetry: `latestBlock`, `latestBlockAt`, " +
        "`txCount24h`, `txCountTotal`, `avgTps24h`, `maxTps24h`, `activeAddresses24h`, `feesPaid24h`, plus `vmName`, " +
        "EVM `chainId`, `blockchainId`, `subnetId`, `rpcUrl` and `explorerUrl`. " +
        "This directory lists L1s/subnets only — the C-Chain primary network (43114) is not one of them, so do not " +
        "expect it here; use `snowline_local_network_stats` for C-Chain figures. " +
        "Use this to answer which L1s are genuinely active: `txCount24h` and `activeAddresses24h` are the honest " +
        "signals, not a chain's presence in the directory.",
      inputSchema: {
        chainId: z
          .string()
          .min(1)
          .max(20)
          .regex(/^[0-9]+$/, "Must be a numeric EVM chain ID.")
          .optional()
          .describe("EVM chain ID for a single L1, e.g. '4337' for Beam L1 or '1510' for Orange."),
        q: z
          .string()
          .min(1)
          .max(80)
          .optional()
          .describe("Local text match over chain name and symbol. Results are partial."),
        limit: limitSchema,
      },
      annotations: READ_ONLY,
    },
    async ({ chainId, q, limit }) => {
      try {
        const effective = clampLimit(limit, client);

        // `chainId` and `q` are applied locally: the L1 directory route is not
        // part of the published OpenAPI document, so its parameter support is
        // not guaranteed and filtering here is the only reliable behaviour.
        const needsScan = chainId !== undefined || q !== undefined;
        const requestLimit = needsScan ? Math.max(effective, client.maxLimit) : effective;

        const body = await client.request("l1Chains", { query: { limit: requestLimit } });
        // This route returns its collection under `data` rather than a named key.
        const scanned = pickArray(body, "data");
        const envelope = buildEnvelope(body);

        let matched = scanned;
        if (chainId !== undefined) {
          matched = matched.filter((item) => strField(item, ["chainId"]).includes(chainId));
        }
        if (q !== undefined) {
          matched = filterByQuery(matched, q, (item) => strField(item, ["name", "symbol"]));
        }

        envelope.data = trim(matched, effective);
        envelope.meta.limit = effective;
        if (needsScan) {
          markClientSideFiltered(envelope, { matched: matched.length, scanned: scanned.length });
        } else {
          envelope.meta.count = matched.length;
        }

        return ok(envelope, summarize(envelope, "L1 chains"));
      } catch (error) {
        return fail(error);
      }
    }
  );
}
