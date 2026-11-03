import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { SnowlineApiError } from "../client.js";
import type { SnowlineEnvelope } from "../envelope.js";

/** Text block + machine-readable payload, which is what MCP clients expect. */
export function ok(envelope: SnowlineEnvelope<unknown>, summary: string): CallToolResult {
  return {
    content: [{ type: "text", text: `${summary}\n\n${JSON.stringify(envelope, null, 2)}` }],
    structuredContent: envelope as unknown as Record<string, unknown>,
  };
}

/**
 * Turns any thrown value into a tool result.
 *
 * Returned with `isError: true` rather than thrown, so the calling model sees
 * a message it can act on instead of losing the whole turn. The API key is
 * never part of an error message — only the URL, which carries no credentials.
 */
export function fail(error: unknown): CallToolResult {
  if (error instanceof SnowlineApiError) {
    const lines = [`Snowline API error (${error.code}): ${error.message}`];
    if (error.resolution) lines.push(`Resolution: ${error.resolution}`);
    if (error.retryAfterSeconds !== null) {
      lines.push(`Retry after: ${error.retryAfterSeconds}s`);
    }
    lines.push(`Request: ${error.requestUrl}`);

    return {
      isError: true,
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: {
        error: {
          code: error.code,
          status: error.status,
          message: error.message,
          detail: error.detail,
          resolution: error.resolution,
          retry_after_seconds: error.retryAfterSeconds,
          request_url: error.requestUrl,
        },
      },
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text", text: `Snowline MCP error: ${message}` }],
    structuredContent: { error: { code: "internal_error", message } },
  };
}

/** Describes payload size, handling both collections and multi-feed objects. */
function describeSize(data: unknown, noun: string): string {
  if (Array.isArray(data)) return `${data.length} ${noun}`;

  if (typeof data === "object" && data !== null) {
    const feeds = Object.entries(data).filter(([, value]) => Array.isArray(value));
    if (feeds.length > 0) {
      return feeds
        .map(([key, value]) => `${(value as unknown[]).length} ${key.replace(/_/g, " ")}`)
        .join(" + ");
    }
    return noun;
  }

  if (data === null || data === undefined) return `no ${noun}`;
  return noun;
}

/**
 * A one-line, human-readable digest placed above the JSON payload.
 *
 * Flags `stale` because an agent that cannot tell fresh from stale data will
 * happily present a two-day-old snapshot as current.
 */
export function summarize(envelope: SnowlineEnvelope<unknown>, noun: string): string {
  const { data, meta, sources, last_updated } = envelope;

  const parts: string[] = [`Returned ${describeSize(data, noun)}.`];

  if (last_updated) parts.push(`Last updated ${last_updated}.`);
  if (meta.stale === true) parts.push("WARNING: this snapshot is flagged stale by Snowline.");
  if (meta.filtered_client_side === true) {
    // Being explicit matters: an agent must not read a partial match as a
    // complete index of the ecosystem.
    parts.push(
      `Note: the API cannot filter this collection, so ${String(
        meta.scanned ?? "?"
      )} records were scanned and the result is partial.`
    );
  }
  if (sources.length > 0) {
    parts.push(
      `Sources: ${sources.map((s) => (s.url ? `${s.name ?? s.key} <${s.url}>` : s.name ?? s.key)).join(", ")}.`
    );
  }

  return parts.join(" ");
}
