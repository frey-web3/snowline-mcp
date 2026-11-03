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

/**
 * "Builders" in the spec are ecosystem users in the API: the `/v1/users`
 * collection. The route exposes no search parameter, so `q` filters locally.
 */
export function registerBuilders(server: McpServer, client: SnowlineClient): void {
  server.registerTool(
    "snowline_local_builders",
    {
      title: "Snowline builders",
      description:
        "Ecosystem builders, founders and contributors tracked by Snowline. Pass `slug` for one builder's profile; " +
        "omit it to list. Records include `role`, `category`, `verified` and linked accounts (twitter/github/website), " +
        "which is what to weigh when judging whether a builder is real and active. " +
        "NOTE: the users route has no server-side search, so `q` filters the fetched page locally and the response is " +
        "marked `meta.filtered_client_side` — treat those matches as partial.",
      inputSchema: {
        slug: slugSchema
          .optional()
          .describe("Builder slug or identifier for a full profile. Omit to list builders."),
        q: z
          .string()
          .min(1)
          .max(120)
          .optional()
          .describe(
            "Local text match over username, name, role and category. The API cannot search users, so results are partial."
          ),
        limit: limitSchema,
      },
      annotations: READ_ONLY,
    },
    async ({ slug, q, limit }) => {
      try {
        const effective = clampLimit(limit, client);

        if (slug !== undefined) {
          const body = await client.request("user", { pathParams: { slug } });
          const envelope = buildEnvelope(body, { payloadKey: "user", evidence: true });
          return ok(envelope, summarize(envelope, "builder profile"));
        }

        const body = await client.request("users", { query: { limit: effective } });
        const envelope = buildEnvelope(body, { payloadKey: "users", limit: effective });

        if (q === undefined) {
          return ok(envelope, summarize(envelope, "builders"));
        }

        const scanned = pickArray(body, "users");
        const matched = filterByQuery(scanned, q, (item) =>
          strField(item, ["username", "name", "slug", "role", "category"])
        );
        envelope.data = trim(matched, effective);
        markClientSideFiltered(envelope, { matched: matched.length, scanned: scanned.length });
        return ok(envelope, summarize(envelope, "matching builders"));
      } catch (error) {
        return fail(error);
      }
    }
  );
}
