import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SnowlineClient } from "../client.js";
import { buildEnvelope } from "../envelope.js";
import {
  READ_ONLY,
  addressSchema,
  clampLimit,
  filterByQuery,
  limitSchema,
  markClientSideFiltered,
  pickArray,
  strField,
  trim,
} from "./common.js";
import { fail, ok, summarize } from "./respond.js";

export function registerTokens(server: McpServer, client: SnowlineClient): void {
  server.registerTool(
    "snowline_local_tokens",
    {
      title: "Snowline tokens",
      description:
        "Avalanche token intelligence backed by live DexScreener data. Three modes: " +
        "pass `slug` (symbol or contract address) for one token's profile; pass `addresses` to resolve specific " +
        "contracts; or call with neither to get the trending list. Records include `priceUsd`, `priceChange24h`, " +
        "`liquidityUsd`, `marketCapUsd`, `priceAsOf`, `priceSource` and `verified`. " +
        "Prices are third-party market data, not Snowline-verified facts — always report `priceAsOf` alongside a price.",
      inputSchema: {
        slug: z
          .string()
          .min(1)
          .max(120)
          .optional()
          .describe("Token address or symbol for one profile, e.g. 'AVAX' or a 0x contract address."),
        addresses: z
          .array(addressSchema)
          .min(1)
          .max(50)
          .optional()
          .describe("Up to 50 contract addresses to resolve in one call."),
        q: z
          .string()
          .min(1)
          .max(80)
          .optional()
          .describe(
            "Local text match over name and symbol on the trending list. The trending route has no search, so results are partial."
          ),
        limit: limitSchema,
      },
      annotations: READ_ONLY,
    },
    async ({ slug, addresses, q, limit }) => {
      try {
        const effective = clampLimit(limit, client);

        if (slug !== undefined) {
          const body = await client.request("token", { pathParams: { slug } });
          const envelope = buildEnvelope(body, { payloadKey: "profile", evidence: true });
          return ok(envelope, summarize(envelope, "token profile"));
        }

        if (addresses !== undefined && addresses.length > 0) {
          const body = await client.request("tokenLookup", {
            query: { addresses: addresses.join(",") },
          });
          const envelope = buildEnvelope(body, { payloadKey: "tokens", limit: effective });
          return ok(envelope, summarize(envelope, "token records"));
        }

        // `/v1/intel/tokens` takes no parameters, so `limit` and `q` are applied here.
        const body = await client.request("tokens");
        const envelope = buildEnvelope(body, { payloadKey: "tokens", limit: effective });
        const scanned = pickArray(body, "tokens");

        if (q === undefined) {
          envelope.data = trim(scanned, effective);
          return ok(envelope, summarize(envelope, "trending tokens"));
        }

        const matched = filterByQuery(scanned, q, (item) => strField(item, ["name", "symbol"]));
        envelope.data = trim(matched, effective);
        markClientSideFiltered(envelope, { matched: matched.length, scanned: scanned.length });
        return ok(envelope, summarize(envelope, "matching tokens"));
      } catch (error) {
        return fail(error);
      }
    }
  );
}
