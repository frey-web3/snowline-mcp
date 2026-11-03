import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SnowlineClient } from "../client.js";
import { buildEnvelope, type SnowlineEnvelope, type SourceRef } from "../envelope.js";
import { READ_ONLY, clampLimit, limitSchema, markClientSideFiltered, pickArray, strField } from "./common.js";
import { fail, ok, summarize } from "./respond.js";

const SOURCES = ["updates", "press_releases", "both"] as const;

function mergeSources(a: SourceRef[], b: SourceRef[]): SourceRef[] {
  const seen = new Set(a.map((s) => `${s.key}|${s.url ?? ""}`));
  const out = [...a];
  for (const ref of b) {
    const id = `${ref.key}|${ref.url ?? ""}`;
    if (!seen.has(id)) {
      seen.add(id);
      out.push(ref);
    }
  }
  return out;
}

/** Keeps only records whose `publishedAt` falls inside an optional ISO date window. */
function withinWindow(items: unknown[], from: string | undefined, to: string | undefined): unknown[] {
  if (from === undefined && to === undefined) return items;

  const fromMs = from !== undefined ? Date.parse(from) : undefined;
  const toMs = to !== undefined ? Date.parse(to) : undefined;
  if (fromMs !== undefined && Number.isNaN(fromMs)) return items;
  if (toMs !== undefined && Number.isNaN(toMs)) return items;

  return items.filter((item) => {
    const raw = strField(item, ["publishedAt"])[0];
    if (raw === undefined) return false;
    const ts = Date.parse(raw);
    if (Number.isNaN(ts)) return false;
    if (fromMs !== undefined && ts < fromMs) return false;
    if (toMs !== undefined && ts > toMs) return false;
    return true;
  });
}

/**
 * Latest ecosystem intelligence: builder updates and press releases.
 *
 * The API publishes a publication timestamp but no date-range parameter, so
 * `date_from`/`date_to` are filtered locally and the response says so.
 */
export function registerLatestIntel(server: McpServer, client: SnowlineClient): void {
  server.registerTool(
    "snowline_local_latest_intel",
    {
      title: "Snowline latest intel",
      description:
        "The latest ecosystem intelligence from Snowline: builder/company `updates` (milestones, product launches, " +
        "network upgrades) and `press_releases`. Each record carries `publishedAt`, `sourceUrl`, `sourceArticles`, " +
        "`businessName`/`businessSlug` and a `category`. " +
        "Use `source: 'both'` for the widest picture. Prefer records with a `sourceUrl` or `sourceArticles` when " +
        "making a factual claim, and treat an update without a source link as a weaker signal. " +
        "Date filtering is applied locally because the API has no date-range parameter.",
      inputSchema: {
        source: z
          .enum(SOURCES)
          .optional()
          .describe("Which feed to read. Defaults to 'both'."),
        business: z
          .string()
          .min(1)
          .max(120)
          .optional()
          .describe("Restrict to one business by slug or name, e.g. 'avalanche'."),
        category: z
          .string()
          .min(1)
          .max(80)
          .optional()
          .describe("Updates only: exact category filter. 'All' means no filter."),
        date_from: z
          .string()
          .min(4)
          .max(40)
          .optional()
          .describe("Inclusive lower bound on `publishedAt`, as an ISO date or timestamp (e.g. '2026-01-01'). Filtered locally."),
        date_to: z
          .string()
          .min(4)
          .max(40)
          .optional()
          .describe("Inclusive upper bound on `publishedAt`, as an ISO date or timestamp. Filtered locally."),
        limit: limitSchema,
      },
      annotations: READ_ONLY,
    },
    async ({ source, business, category, date_from, date_to, limit }) => {
      try {
        const effective = clampLimit(limit, client);
        const feed = source ?? "both";
        const wantUpdates = feed === "updates" || feed === "both";
        const wantPress = feed === "press_releases" || feed === "both";

        const payload: Record<string, unknown> = {};
        let envelope: SnowlineEnvelope<unknown> | null = null;
        let scanned = 0;
        let matched = 0;
        const wantsWindow = date_from !== undefined || date_to !== undefined;

        if (wantUpdates) {
          const body = await client.request("updates", {
            query: {
              business,
              category,
              limit: wantsWindow ? Math.max(effective, client.maxLimit) : effective,
            },
          });
          const all = pickArray(body, "updates");
          const kept = withinWindow(all, date_from, date_to);
          payload.updates = kept.slice(0, effective);
          scanned += all.length;
          matched += kept.length;
          envelope = buildEnvelope(body, { limit: effective });
        }

        if (wantPress) {
          const body = await client.request("pressReleases", {
            query: {
              business,
              limit: wantsWindow ? Math.max(effective, client.maxLimit) : effective,
            },
          });
          const all = pickArray(body, "pressReleases");
          const kept = withinWindow(all, date_from, date_to);
          payload.press_releases = kept.slice(0, effective);
          scanned += all.length;
          matched += kept.length;

          if (envelope === null) {
            envelope = buildEnvelope(body, { limit: effective });
          } else {
            envelope.sources = mergeSources(
              envelope.sources,
              buildEnvelope(body).sources
            );
          }
        }

        // Both branches always run at least once, so envelope is never null.
        const result = envelope ?? buildEnvelope({});
        result.data = feed === "both" ? payload : (Object.values(payload)[0] ?? []);

        if (wantsWindow) {
          markClientSideFiltered(result, { matched, scanned });
        }

        return ok(result, summarize(result, "intel records"));
      } catch (error) {
        return fail(error);
      }
    }
  );
}
