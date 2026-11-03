import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SnowlineApiError, type SnowlineClient } from "../client.js";
import type { Endpoint, EndpointRegistry } from "../openapi.js";
import { READ_ONLY } from "./common.js";
import { fail, ok } from "./respond.js";

/** Compact catalog entry: what a model needs to pick a call, and nothing more. */
function toCatalogEntry(endpoint: Endpoint): Record<string, unknown> {
  const query = endpoint.params.filter((p) => p.in === "query");
  const entry: Record<string, unknown> = {
    path: endpoint.specPath,
    operation_id: endpoint.operationId,
    summary: endpoint.summary,
  };

  if (query.length > 0) {
    entry.query = query.map((p) => {
      const spec: Record<string, unknown> = { name: p.name, type: p.type };
      if (p.required) spec.required = true;
      if (p.enumValues) spec.allowed = p.enumValues;
      if (p.minimum !== undefined) spec.min = p.minimum;
      if (p.maximum !== undefined) spec.max = p.maximum;
      if (p.defaultValue !== undefined) spec.default = p.defaultValue;
      if (p.description) spec.description = p.description;
      return spec;
    });
  }

  const pathParams = endpoint.params.filter((p) => p.in === "path");
  if (pathParams.length > 0) {
    entry.path_params = pathParams.map((p) => p.name);
  }

  return entry;
}

/**
 * The escape hatch: call any endpoint Snowline publishes under `/v1`.
 *
 * This exists so a newly added API route is reachable **without republishing
 * this package** — the registry re-reads Snowline's OpenAPI document, and the
 * document is the allow-list. It is not a general HTTP client: the method is
 * always GET, the host comes from configuration, and both the path and every
 * query key must appear in the document.
 */
export function registerApiTool(
  server: McpServer,
  client: SnowlineClient,
  registry: EndpointRegistry
): void {
  server.registerTool(
    "snowline_local_api",
    {
      title: "Call any documented Snowline endpoint",
      description:
        "Call any Snowline API endpoint published under /v1, including ones added after this package was released. " +
        "Omit `path` to list every available endpoint with its parameters and allowed values — do that first if you " +
        "are unsure. Only GET is supported. The path must be one Snowline documents (for example " +
        "'/api/v1/businesses'), and `query` may only use parameter names that endpoint declares; anything else is " +
        "rejected rather than silently ignored. " +
        "Prefer the curated tools (snowline_local_businesses, snowline_local_projects, ...) when one fits: they add " +
        "filtering, partial-result labelling and evidence projection that a raw call does not.",
      inputSchema: {
        path: z
          .string()
          .min(4)
          .max(200)
          .optional()
          .describe(
            "Documented endpoint path, e.g. '/api/v1/businesses' or '/v1/avax/l1-chains'. Omit to list all endpoints."
          ),
        path_params: z
          .record(z.string(), z.string())
          .optional()
          .describe("Values for {placeholders}, e.g. { \"slug\": \"avalanche\" } for '/api/v1/businesses/{slug}'."),
        query: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe("Query parameters. Only names the endpoint declares are accepted."),
      },
      annotations: READ_ONLY,
    },
    async ({ path, path_params, query }) => {
      try {
        // Discovery mode: no path means "show me what is callable".
        if (path === undefined) {
          const endpoints = await registry.endpoints();
          const catalog = endpoints.map(toCatalogEntry);
          const envelope = {
            data: catalog,
            meta: {
              count: catalog.length,
              source: "Snowline OpenAPI document",
              note: "Paths are shown as Snowline publishes them. All are GET.",
            },
            sources: [{ key: "openapi", name: "Snowline OpenAPI", url: `${client.apiUrl}/v1/openapi.json` }],
            last_updated: null,
          };
          return ok(envelope, `Returned ${catalog.length} documented endpoints.`);
        }

        const endpoint = await registry.resolve(path);
        if (!endpoint) {
          const endpoints = await registry.endpoints();
          throw new SnowlineApiError({
            message: `"${path}" is not an endpoint Snowline publishes under /v1.`,
            status: 0,
            code: "unknown_endpoint",
            requestUrl: path,
            resolution:
              endpoints.length > 0
                ? `Call this tool without \`path\` to list all ${endpoints.length} endpoints.`
                : "The OpenAPI document could not be read, so nothing is callable right now.",
          });
        }

        const queryArgs = registry.validateQuery(endpoint, query ?? {});
        const resolvedPath = registry.substitutePath(endpoint, path_params ?? {});
        const body = await client.requestPath(resolvedPath, queryArgs);

        const envelope = {
          data: body,
          meta: {
            path: endpoint.specPath,
            operation_id: endpoint.operationId,
            query: queryArgs,
          },
          sources: [{ key: "openapi", name: "Snowline OpenAPI", url: `${client.apiUrl}/v1/openapi.json` }],
          last_updated: null,
        };

        return ok(envelope, `Called ${endpoint.specPath}.`);
      } catch (error) {
        return fail(error);
      }
    }
  );
}
