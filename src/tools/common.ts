import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { SnowlineClient } from "../client.js";
import { API_MAX_LIMIT } from "../config.js";
import { capList, type SnowlineEnvelope } from "../envelope.js";

/**
 * Every Snowline tool is a read-only network lookup, so the annotations are
 * identical and stated once. `openWorldHint` tells the client the results are
 * not a closed set the model can memorise.
 */
export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

/**
 * Snowline is a `limit`-based API with no `page` parameter, so the tools expose
 * `limit` only. Documenting that here keeps the tool descriptions truthful.
 */
export const limitSchema = z
  .number()
  .int()
  .min(1)
  .max(API_MAX_LIMIT)
  .optional()
  .describe(
    `Maximum records to return (1-${API_MAX_LIMIT}). The Snowline API has no page parameter — raise this or narrow the filter to see more.`
  );

/** Slug or identifier segment. The charset keeps it safe to place in a URL path. */
export const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~@-]*$/, "Must be a Snowline slug or identifier.")
  .describe("Snowline slug or identifier, e.g. 'avalanche'.");

/** 42-character EVM address. */
export const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a 42-character EVM address (0x + 40 hex digits).")
  .describe("EVM wallet address, e.g. '0x0000000000000000000000000000000000000000'.");

/** Applies the server config, the environment cap and the API's own 100-row ceiling. */
export function clampLimit(requested: number | undefined, client: SnowlineClient): number {
  const value = requested ?? client.defaultLimit;
  return Math.max(1, Math.min(value, client.maxLimit, API_MAX_LIMIT));
}

/**
 * Case-insensitive local match over selected fields.
 *
 * Used only for collections the Snowline API cannot filter server-side; the
 * caller must mark the result `filtered_client_side` so an agent knows the
 * match set is a page, not an index.
 */
export function filterByQuery<T>(
  items: T[],
  query: string,
  pick: (item: T) => Array<string | null | undefined>
): T[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return items;

  return items.filter((item) =>
    pick(item).some((field) => typeof field === "string" && field.toLowerCase().includes(needle))
  );
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Reads a nested array out of an API body without a cast.
 *
 * `noUncheckedIndexedAccess` and `unknown` bodies make ad-hoc property access
 * noisy; this keeps the tool files readable and the access checked.
 */
export function pickArray(body: unknown, key: string): unknown[] {
  return asArray(asRecord(body)[key]);
}

export function pickObject(body: unknown, key: string): Record<string, unknown> | null {
  const value = asRecord(body)[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function str(value: unknown): string | null {
  return asString(value);
}

/** Pulls the first non-empty string among `keys` from a record-shaped item. */
export function strField(item: unknown, keys: string[]): string[] {
  const rec = asRecord(item);
  const out: string[] = [];
  for (const key of keys) {
    const value = asString(rec[key]);
    if (value !== null) out.push(value);
  }
  return out;
}

/**
 * Records that a collection was narrowed locally rather than by the API.
 *
 * `count` is rewritten to the matched total so it never overstates the result,
 * and `scanned` preserves how much of the collection was actually examined.
 */
export function markClientSideFiltered<T>(
  envelope: SnowlineEnvelope<T>,
  opts: { matched: number; scanned: number }
): SnowlineEnvelope<T> {
  envelope.meta.filtered_client_side = true;
  envelope.meta.matched = opts.matched;
  envelope.meta.scanned = opts.scanned;
  envelope.meta.count = opts.matched;
  return envelope;
}

/** Trims a collection to `limit`, reporting whether anything was dropped. */
export function trim<T>(items: T[], limit: number): T[] {
  return capList(items, limit).items;
}
