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

const TYPES = ["all", "businesses", "updates", "projects", "builders", "tokens", "chains"] as const;

/**
 * One entry point across every Snowline collection.
 *
 * Only businesses and updates are searched server-side, by `/v1/search`. The
 * other collections have no search parameter, so they are scanned locally and
 * the response is explicitly marked as partial — a model must not mistake a
 * local match for an exhaustive index of the ecosystem.
 *
 * There is no `validators` type: Snowline publishes no validators collection.
 */
export function registerSearch(server: McpServer, client: SnowlineClient): void {
  server.registerTool(
    "snowline_local_search",
    {
      title: "Search Snowline",
      description:
        "Search the Snowline Avalanche ecosystem in one call. Start here when you have a name, ticker or topic but " +
        "not a slug. `type: 'all'` (default) uses Snowline's own search over businesses and updates. " +
        "For 'projects', 'builders', 'tokens' and 'chains' the API offers no search route, so the collection is " +
        "scanned and matched locally — those results carry `meta.filtered_client_side: true` and a `meta.scanned` " +
        "count and are partial by construction. There is no 'validators' type; validator data lives in " +
        "`snowline_local_network_stats` and `snowline_local_metrics`.",
      inputSchema: {
        query: z
          .string()
          .min(1)
          .max(200)
          .describe("Search text — a name, ticker, topic or slug fragment. A leading $ searches tickers."),
        type: z
          .enum(TYPES)
          .optional()
          .describe("Which collection to search. Defaults to 'all' (businesses + updates, server-side)."),
        category: z
          .string()
          .min(1)
          .max(80)
          .optional()
          .describe("Exact category filter where the underlying collection supports it. 'All' means no filter."),
        limit: limitSchema,
      },
      annotations: READ_ONLY,
    },
    async ({ query, type, category, limit }) => {
      try {
        const effective = clampLimit(limit, client);
        const kind = type ?? "all";

        // Server-side search: businesses + updates in one shot.
        if (kind === "all" || kind === "updates") {
          const body = await client.request("search", { query: { q: query } });
          const envelope = buildEnvelope(body);
          const businesses = pickArray(body, "businesses");
          const updates = pickArray(body, "updates");

          envelope.data =
            kind === "updates"
              ? trim(updates, effective)
              : {
                  businesses: trim(businesses, effective),
                  updates: trim(updates, effective),
                };
          envelope.meta.limit = effective;

          return ok(envelope, summarize(envelope, "search results"));
        }

        if (kind === "businesses") {
          const body = await client.request("businesses", {
            query: { q: query, category, limit: effective },
          });
          const envelope = buildEnvelope(body, { payloadKey: "businesses", limit: effective });
          return ok(envelope, summarize(envelope, "businesses"));
        }

        // Collections with no server-side search: scan the widest page the
        // server permits, match locally, and label the result as partial.
        const scanLimit = Math.max(clampLimit(undefined, client), client.maxLimit);

        let route: "projects" | "users" | "tokens" | "l1Chains";
        let payloadKey: string;
        let fields: string[];

        switch (kind) {
          case "projects":
            route = "projects";
            payloadKey = "projects";
            fields = ["name", "symbol", "slug", "category"];
            break;
          case "builders":
            route = "users";
            payloadKey = "users";
            fields = ["username", "name", "slug", "role", "category"];
            break;
          case "tokens":
            route = "tokens";
            payloadKey = "tokens";
            fields = ["name", "symbol", "address"];
            break;
          case "chains":
            route = "l1Chains";
            payloadKey = "data";
            fields = ["name", "symbol", "chainId"];
            break;
        }

        const body =
          route === "users" || route === "tokens"
            ? await client.request(route)
            : await client.request(route, { query: { category, limit: scanLimit } });

        const scanned = pickArray(body, payloadKey);
        const matched = filterByQuery(scanned, query, (item) => strField(item, fields));

        const envelope = buildEnvelope(body);
        envelope.data = trim(matched, effective);
        envelope.meta.limit = effective;
        markClientSideFiltered(envelope, { matched: matched.length, scanned: scanned.length });

        return ok(envelope, summarize(envelope, `matching ${kind}`));
      } catch (error) {
        return fail(error);
      }
    }
  );
}
