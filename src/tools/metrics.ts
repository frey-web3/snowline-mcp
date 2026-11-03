import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SnowlineClient } from "../client.js";
import { buildEnvelope } from "../envelope.js";
import { READ_ONLY, clampLimit, limitSchema } from "./common.js";
import { fail, ok, summarize } from "./respond.js";

const RANGES = ["24h", "7d", "30d", "90d"] as const;

/**
 * Backs the metric catalog and its time series.
 *
 * This replaces the spec's `snowline_validators`: Snowline publishes no
 * validators endpoint, so staking and validator-related series are reached
 * through the metrics API instead, which is where they actually live.
 */
export function registerMetrics(server: McpServer, client: SnowlineClient): void {
  server.registerTool(
    "snowline_local_metrics",
    {
      title: "Snowline metrics",
      description:
        "Snowline's network metric catalog and historical time series. " +
        "Call with no `metric` to list every available metric with its latest value — this is how you discover valid " +
        "metric keys (e.g. 'tps', 'activeAddresses', 'txCount', 'gasUsed', 'feesPaid', 'contracts'). " +
        "Call with `metric` to get that series over `range`, or with `metric` + `latest: true` for the newest point only. " +
        "Each bucket carries `source`, `fetchedAt` and `provisional`, so you can tell a settled value from a provisional one.",
      inputSchema: {
        metric: z
          .string()
          .min(1)
          .max(80)
          .regex(/^[A-Za-z0-9._-]+$/, "Must be a metric key such as 'tps'.")
          .optional()
          .describe("Metric key to retrieve a series for. Omit to list the catalog."),
        range: z
          .enum(RANGES)
          .optional()
          .describe("Series window for a single metric (default '7d'). 24h returns hourly buckets, longer ranges daily."),
        latest: z
          .boolean()
          .optional()
          .describe("With `metric`: return only the most recent point instead of the full series."),
        category: z
          .string()
          .min(1)
          .max(80)
          .optional()
          .describe("Catalog-only: exact category filter. 'All' means no filter."),
        limit: limitSchema,
      },
      annotations: READ_ONLY,
    },
    async ({ metric, range, latest, category, limit }) => {
      try {
        const effective = clampLimit(limit, client);

        if (metric === undefined) {
          const body = await client.request("metrics", {
            query: { category, limit: effective },
          });
          const envelope = buildEnvelope(body, { payloadKey: "metrics", limit: effective });
          return ok(envelope, summarize(envelope, "metrics"));
        }

        if (latest === true) {
          const body = await client.request("metricLatest", { pathParams: { metric } });
          const envelope = buildEnvelope(body, { payloadKey: "latest" });
          return ok(envelope, summarize(envelope, `latest points for ${metric}`));
        }

        const body = await client.request("metricSeries", {
          pathParams: { metric },
          query: { range: range ?? "7d" },
        });
        const envelope = buildEnvelope(body, { payloadKey: "data" });
        // The route reports which window it actually served.
        envelope.meta.range = (body as Record<string, unknown>).range ?? range ?? "7d";
        envelope.meta.granularity = (body as Record<string, unknown>).granularity ?? null;
        return ok(envelope, summarize(envelope, `points for ${metric}`));
      } catch (error) {
        return fail(error);
      }
    }
  );
}
