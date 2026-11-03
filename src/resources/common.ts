import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import type { SnowlineEnvelope } from "../envelope.js";

/**
 * Wraps an envelope as a resource read result.
 *
 * Resources are read-only and must be bounded — a client that subscribes to
 * `snowline://chains` gets a page, not the whole directory, so the MCP channel
 * never carries an unbounded payload.
 */
export function resourceJson(uri: URL, envelope: SnowlineEnvelope<unknown>): ReadResourceResult {
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: JSON.stringify(envelope, null, 2),
      },
    ],
  };
}

/** Page size for resources: bounded independently of any tool argument. */
export const RESOURCE_LIMIT = 50;
