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
  slugSchema,
  strField,
  trim,
} from "./common.js";
import { fail, ok, summarize } from "./respond.js";

export function registerProjects(server: McpServer, client: SnowlineClient): void {
  server.registerTool(
    "snowline_local_projects",
    {
      title: "Snowline projects",
      description:
        "Avalanche ecosystem projects and dApps tracked by Snowline. Pass `slug` for one project's full profile; " +
        "omit it to list and filter by `category`. Tokens are reported separately by `snowline_local_tokens`. " +
        "NOTE: the projects route has no server-side text search, so `q` filters the fetched page locally and the " +
        "response is marked `meta.filtered_client_side` with a `meta.scanned` total — treat those matches as partial.",
      inputSchema: {
        slug: slugSchema
          .optional()
          .describe("Project slug for a full profile, e.g. 'Team1FR'. Omit to list projects."),
        q: z
          .string()
          .min(1)
          .max(120)
          .optional()
          .describe(
            "Local text match over name, symbol and category. The API cannot search projects, so results are partial."
          ),
        category: z
          .string()
          .min(1)
          .max(80)
          .optional()
          .describe("Exact category filter, e.g. 'Community'. 'All' means no filter."),
        limit: limitSchema,
      },
      annotations: READ_ONLY,
    },
    async ({ slug, q, category, limit }) => {
      try {
        const effective = clampLimit(limit, client);

        if (slug !== undefined) {
          const body = await client.request("project", { pathParams: { slug } });
          const envelope = buildEnvelope(body, { payloadKey: "project", evidence: true });
          return ok(envelope, summarize(envelope, "project profile"));
        }

        if (q === undefined) {
          const body = await client.request("projects", {
            query: { category, limit: effective },
          });
          const envelope = buildEnvelope(body, { payloadKey: "projects", limit: effective });
          return ok(envelope, summarize(envelope, "projects"));
        }

        // No server-side search: scan the largest page the server allows, then
        // narrow locally and be explicit that the match set is partial.
        const scanLimit = Math.max(effective, client.maxLimit);
        const body = await client.request("projects", {
          query: { category, limit: scanLimit },
        });
        const scanned = pickArray(body, "projects");
        const matched = filterByQuery(scanned, q, (item) =>
          strField(item, ["name", "symbol", "slug", "category"])
        );

        const envelope = buildEnvelope(body, {
          payloadKey: "projects",
          limit: effective,
        });
        envelope.data = trim(matched, effective);
        markClientSideFiltered(envelope, { matched: matched.length, scanned: scanned.length });
        return ok(envelope, summarize(envelope, "matching projects"));
      } catch (error) {
        return fail(error);
      }
    }
  );
}
