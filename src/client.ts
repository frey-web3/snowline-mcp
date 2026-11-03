import type { SnowlineConfig } from "./config.js";

/**
 * The complete set of Snowline API routes this server may reach.
 *
 * Tools select a route *key*; they never supply a path. That is what makes
 * "no unrestricted API path forwarding" a structural property rather than a
 * convention — there is no code path that can build a URL from model output.
 */
export const ROUTES = {
  search: "/v1/search",

  businesses: "/v1/businesses",
  business: "/v1/businesses/{slug}",

  projects: "/v1/projects",
  project: "/v1/projects/{slug}",

  users: "/v1/users",
  user: "/v1/users/{slug}",

  updates: "/v1/updates",
  update: "/v1/updates/{slug}",

  pressReleases: "/v1/press-releases",
  pressRelease: "/v1/press-releases/{slug}",

  tokens: "/v1/intel/tokens",
  token: "/v1/intel/token/{slug}",
  tokenLookup: "/v1/intel/tokens/lookup",
  addresses: "/v1/intel/addresses",
  transactions: "/v1/intel/transactions",

  metrics: "/v1/metrics",
  metricSeries: "/v1/metrics/{metric}",
  metricLatest: "/v1/metrics/{metric}/latest",

  stats: "/v1/stats",
  market: "/v1/market",
  reports: "/v1/reports",

  l1Chains: "/v1/avax/l1-chains",
  chainStats: "/v1/avax/chain-stats",

  /** The document that drives `snowline_local_api`. */
  openapi: "/v1/openapi.json",
} as const;

export type RouteKey = keyof typeof ROUTES;

export interface RequestOptions {
  /** Values substituted into `{placeholder}` segments of the route. */
  pathParams?: Record<string, string>;
  /** Appended as a query string; empty strings, null and undefined are dropped. */
  query?: Record<string, string | number | boolean | null | undefined>;
}

/** A structured, credential-free description of a failed API call. */
export class SnowlineApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string | null;
  readonly resolution: string | null;
  readonly retryAfterSeconds: number | null;
  readonly requestUrl: string;

  constructor(init: {
    message: string;
    status: number;
    code: string;
    requestUrl: string;
    detail?: string | null;
    resolution?: string | null;
    retryAfterSeconds?: number | null;
  }) {
    super(init.message);
    this.name = "SnowlineApiError";
    this.status = init.status;
    this.code = init.code;
    this.requestUrl = init.requestUrl;
    this.detail = init.detail ?? null;
    this.resolution = init.resolution ?? null;
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
  }
}

interface CappedBody {
  text: string;
  truncated: boolean;
}

/** Read at most `maxBytes` of a response body, so a huge payload cannot exhaust memory. */
async function readCapped(res: Response, maxBytes: number): Promise<CappedBody> {
  const body = res.body;
  if (!body) return { text: "", truncated: false };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      if (total + value.byteLength > maxBytes) {
        truncated = true;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream may already be closed; nothing to do.
    }
  }

  return { text: Buffer.concat(chunks).toString("utf8"), truncated };
}

/** RFC 7807 problem body, which the Snowline API returns for 4xx/5xx. */
interface ProblemBody {
  title?: unknown;
  detail?: unknown;
  code?: unknown;
  resolution?: unknown;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  return null;
}

export class SnowlineClient {
  readonly #config: SnowlineConfig;

  constructor(config: SnowlineConfig) {
    this.#config = config;
  }

  /** Base URL, safe to show to a user (it never contains the API key). */
  get apiUrl(): string {
    return this.#config.apiUrl;
  }

  get defaultLimit(): number {
    return this.#config.defaultLimit;
  }

  get maxLimit(): number {
    return this.#config.maxLimit;
  }

  /**
   * Call one endpoint from the frozen {@link ROUTES} allow-list.
   *
   * Every curated tool goes through here, so no model output can influence the
   * path. Spec-driven calls take {@link requestPath} instead.
   */
  async request<T = unknown>(route: RouteKey, options: RequestOptions = {}): Promise<T> {
    const url = this.#buildUrl(route, options);

    if (options.pathParams) {
      for (const value of Object.values(options.pathParams)) {
        if (value === "" || value.includes("/")) {
          throw new SnowlineApiError({
            message: `Invalid path parameter value: ${JSON.stringify(value)}`,
            status: 0,
            code: "invalid_path_param",
            requestUrl: url,
          });
        }
      }
    }

    return this.#send<T>(url);
  }

  /**
   * Call a base-relative path. Used only by the OpenAPI-driven tool.
   *
   * Defence in depth: {@link EndpointRegistry} has already matched `path`
   * against Snowline's own published document, and these guards independently
   * reject traversal, absolute URLs and anything outside the versioned
   * surface — so even a bug in the registry cannot make this arbitrary
   * fetching.
   */
  async requestPath<T = unknown>(
    path: string,
    query: Record<string, string | number | boolean> = {}
  ): Promise<T> {
    const forbidden = ["..", "//", ":", "\\", "?"].find((token) => path.includes(token));

    if (!path.startsWith("/v1/") || forbidden !== undefined) {
      throw new SnowlineApiError({
        message: `Refusing to call ${path}${forbidden ? ` (contains "${forbidden}")` : " (outside /v1)"}.`,
        status: 0,
        code: "unsupported_path",
        requestUrl: path,
        resolution: "Use a path from the endpoint catalog, e.g. '/api/v1/businesses'.",
      });
    }

    const url = new URL(`${this.#config.apiUrl}${path}`);

    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }

    return this.#send<T>(url.toString());
  }

  /**
   * Performs the GET and returns the parsed JSON body.
   *
   * @throws {SnowlineApiError} on timeout, network failure, non-2xx status,
   *   an oversized body, or a body that is not JSON.
   */
  async #send<T>(url: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#config.timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: this.#headers(),
      });
    } catch (err) {
      const aborted = controller.signal.aborted;
      throw new SnowlineApiError({
        message: aborted
          ? `Snowline API request timed out after ${this.#config.timeoutMs}ms.`
          : `Could not reach the Snowline API: ${(err as Error).message}`,
        status: 0,
        code: aborted ? "timeout" : "network_error",
        requestUrl: url,
        resolution: aborted
          ? "Retry, raise SNOWLINE_TIMEOUT_MS, or narrow the query."
          : "Check network connectivity and SNOWLINE_API_URL.",
      });
    } finally {
      clearTimeout(timer);
    }

    const capped = await readCapped(res, this.#config.maxResponseBytes);

    if (!res.ok) {
      throw this.#toHttpError(res, capped.text, url);
    }

    if (capped.truncated) {
      throw new SnowlineApiError({
        message: `Snowline API response exceeded ${this.#config.maxResponseBytes} bytes and was discarded.`,
        status: res.status,
        code: "response_too_large",
        requestUrl: url,
        resolution:
          "Narrow the query — lower `limit`, add a category/business filter, or request a single record by slug.",
      });
    }

    if (capped.text.trim() === "") {
      throw new SnowlineApiError({
        message: "Snowline API returned an empty body.",
        status: res.status,
        code: "empty_response",
        requestUrl: url,
      });
    }

    try {
      return JSON.parse(capped.text) as T;
    } catch {
      throw new SnowlineApiError({
        message: "Snowline API returned a body that is not valid JSON.",
        status: res.status,
        code: "invalid_json",
        requestUrl: url,
        detail: capped.text.slice(0, 200),
      });
    }
  }

  #headers(): Record<string, string> {
    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": "snowline-mcp/2.0.0",
    };

    // The public API needs no credentials; this only matters for a private
    // deployment. The key is never logged and never placed in a URL.
    if (this.#config.apiKey) {
      headers.authorization = `Bearer ${this.#config.apiKey}`;
    }

    return headers;
  }

  #buildUrl(route: RouteKey, options: RequestOptions): string {
    let path: string = ROUTES[route];

    for (const [key, value] of Object.entries(options.pathParams ?? {})) {
      path = path.replace(`{${key}}`, encodeURIComponent(value));
    }

    if (path.includes("{")) {
      // A missing placeholder is a bug in this package, not a user error.
      throw new SnowlineApiError({
        message: `Route "${route}" is missing a path parameter.`,
        status: 0,
        code: "internal_route_error",
        requestUrl: `${this.#config.apiUrl}${path}`,
      });
    }

    const url = new URL(`${this.#config.apiUrl}${path}`);

    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }

    return url.toString();
  }

  #toHttpError(res: Response, body: string, url: string): SnowlineApiError {
    let problem: ProblemBody = {};
    try {
      problem = JSON.parse(body) as ProblemBody;
    } catch {
      // Not a problem document; fall back to status-derived messaging.
    }

    const detail = asString(problem.detail) ?? asString(problem.title);
    const resolution = asString(problem.resolution);
    const apiCode = asString(problem.code);
    const retryAfter = parseRetryAfter(res.headers.get("retry-after"));

    const advice: Record<number, string> = {
      400: "One or more arguments are invalid. Check the allowed values and retry.",
      401: "The API rejected the credentials in SNOWLINE_API_KEY.",
      402: "The Snowline deployment is disabled (Vercel returned 402 DEPLOYMENT_DISABLED).",
      403: "The API denied access to this resource.",
      404: "No record matched. Verify the slug or address, or search first to find it.",
      429: "Rate limited. Wait for the Retry-After interval before retrying.",
      500: "The Snowline API hit an internal error. Retry shortly.",
      503: "The Snowline API is temporarily unavailable. Retry shortly.",
    };

    const base = `Snowline API ${res.status}${res.statusText ? ` ${res.statusText}` : ""}.`;
    const message = detail ? `${base} ${detail}` : base;

    return new SnowlineApiError({
      message,
      status: res.status,
      code: apiCode ?? `http_${res.status}`,
      requestUrl: url,
      detail,
      resolution: resolution ?? advice[res.status] ?? null,
      retryAfterSeconds: retryAfter,
    });
  }
}
