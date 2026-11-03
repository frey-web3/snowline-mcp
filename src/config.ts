/**
 * Runtime configuration for the Snowline MCP server.
 *
 * Everything is read once, at startup, from the environment. Nothing here is
 * ever reachable from a tool argument, so a model can never redirect the
 * server at an arbitrary host.
 */

/** Public Snowline API. No API key is required for the documented endpoints. */
export const DEFAULT_API_URL = "https://www.snowlineapp.xyz/api";

/** The API rejects `limit` values above 100, so that is our ceiling too. */
export const API_MAX_LIMIT = 100;

export interface SnowlineConfig {
  /** Base API URL, normalized without a trailing slash. */
  apiUrl: string;
  /** Optional bearer token, forwarded only when set. */
  apiKey: string | null;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** Hard cap on a single response body, in bytes. */
  maxResponseBytes: number;
  /** Page size used when a tool call omits `limit`. */
  defaultLimit: number;
  /** Largest `limit` a tool call may request. */
  maxLimit: number;
  /** How long the cached OpenAPI document is trusted, in milliseconds. 0 = always refetch. */
  openapiTtlMs: number;
}

export class SnowlineConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnowlineConfigError";
  }
}

function readInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new SnowlineConfigError(`${name} must be an integer, received "${raw}".`);
  }
  if (parsed < min || parsed > max) {
    throw new SnowlineConfigError(`${name} must be between ${min} and ${max}, received ${parsed}.`);
  }
  return parsed;
}

function readApiUrl(raw: string | undefined): string {
  const value = (raw ?? DEFAULT_API_URL).trim();
  if (value === "") return DEFAULT_API_URL;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SnowlineConfigError(
      `SNOWLINE_API_URL must be an absolute http(s) URL, received "${value}".`
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SnowlineConfigError(
      `SNOWLINE_API_URL must use http or https, received "${url.protocol}".`
    );
  }

  // Drop a trailing slash so route concatenation stays predictable.
  return url.toString().replace(/\/+$/, "");
}

export function loadConfig(): SnowlineConfig {
  const apiKeyRaw = (process.env.SNOWLINE_API_KEY ?? "").trim();

  return {
    apiUrl: readApiUrl(process.env.SNOWLINE_API_URL),
    apiKey: apiKeyRaw === "" ? null : apiKeyRaw,
    timeoutMs: readInt("SNOWLINE_TIMEOUT_MS", 20_000, 1_000, 120_000),
    maxResponseBytes: readInt("SNOWLINE_MAX_RESPONSE_BYTES", 2_000_000, 16_384, 20_000_000),
    defaultLimit: readInt("SNOWLINE_DEFAULT_LIMIT", 20, 1, API_MAX_LIMIT),
    maxLimit: readInt("SNOWLINE_MAX_LIMIT", API_MAX_LIMIT, 1, API_MAX_LIMIT),
    openapiTtlMs: readInt("SNOWLINE_OPENAPI_TTL_MS", 600_000, 0, 3_600_000),
  };
}
