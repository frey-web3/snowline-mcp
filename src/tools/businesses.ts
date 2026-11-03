import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SnowlineClient } from "../client.js";
import { buildEnvelope } from "../envelope.js";
import { READ_ONLY, clampLimit, limitSchema, slugSchema } from "./common.js";
import { fail, ok, summarize } from "./respond.js";

export function registerBusinesses(server: McpServer, client: SnowlineClient): void {
  server.registerTool(
    "snowline_local_businesses",
    {
      title: "Snowline businesses",
      description:
        "Verified Avalanche ecosystem businesses, enterprises and blockchain networks tracked by Snowline. " +
        "Pass `slug` to get one company's full profile (classification, market cap, valuation source, official links). " +
        "Omit `slug` to list and filter. Each record carries `verified`, `marketCapUsd`, `valuationSource` and `sourceUrl`, " +
        "so you can separate verified data from unverified listings.",
      inputSchema: {
        slug: slugSchema
          .optional()
          .describe("Business slug for a full profile, e.g. 'avalanche'. Omit to list businesses."),
        q: z
          .string()
          .min(1)
          .max(120)
          .optional()
          .describe("Case-insensitive name, ticker or category search."),
        ticker: z
          .string()
          .min(1)
          .max(16)
          .optional()
          .describe("Ticker search, e.g. 'AVAX'."),
        category: z
          .string()
          .min(1)
          .max(80)
          .optional()
          .describe(
            "Exact category filter, e.g. 'Layer 1 Blockchain', 'DeFi & Infrastructure', 'Enterprise Software', 'Tokenized RWA'. 'All' means no filter."
          ),
        limit: limitSchema,
      },
      annotations: READ_ONLY,
    },
    async ({ slug, q, ticker, category, limit }) => {
      try {
        const effective = clampLimit(limit, client);

        if (slug !== undefined) {
          const body = await client.request("business", { pathParams: { slug } });
          const envelope = buildEnvelope(body, { payloadKey: "business", evidence: true });
          return ok(envelope, summarize(envelope, "business profile"));
        }

        const body = await client.request("businesses", {
          query: { q, ticker, category, limit: effective },
        });
        const envelope = buildEnvelope(body, { payloadKey: "businesses", limit: effective });
        return ok(envelope, summarize(envelope, "businesses"));
      } catch (error) {
        return fail(error);
      }
    }
  );
}
