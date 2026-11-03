import { SnowlineApiError, type SnowlineClient } from "./client.js";

/**
 * An endpoint registry built from Snowline's own OpenAPI document.
 *
 * Purpose: let a newly added API endpoint become reachable through
 * `snowline_local_api` **without republishing this package**. The document is
 * fetched once per TTL and every call is checked against it, so the reachable
 * surface is exactly what Snowline publishes — not what a model asks for.
 *
 * This is the one place a model-influenced path reaches a URL, and it is gated
 * three ways: the path must normalize to a key present in the document, must
 * resolve under `/v1/`, and its query keys must be parameters the document
 * declares for that exact endpoint.
 */

export interface EndpointParam {
  name: string;
  in: "path" | "query";
  required: boolean;
  type: "string" | "integer" | "number" | "boolean";
  enumValues?: string[];
  description?: string;
  defaultValue?: string | number | boolean;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
}

export interface Endpoint {
  /** Normalized, base-relative path, e.g. `/v1/businesses/{slug}`. */
  path: string;
  /** Path exactly as Snowline's document publishes it, e.g. `/api/v1/businesses/{slug}`. */
  specPath: string;
  operationId: string;
  summary: string;
  params: EndpointParam[];
}

// --- minimal structural types for the parts of the document we read ---------

interface RawSchema {
  $ref?: string;
  type?: string;
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
}

interface RawParameter {
  $ref?: string;
  name?: string;
  in?: string;
  required?: boolean;
  description?: string;
  schema?: RawSchema;
}

interface RawOperation {
  operationId?: string;
  summary?: string;
  parameters?: RawParameter[];
}

interface RawPathItem {
  parameters?: RawParameter[];
  get?: RawOperation;
  post?: RawOperation;
}

interface RawDocument {
  paths?: Record<string, RawPathItem>;
  components?: {
    parameters?: Record<string, RawParameter>;
    schemas?: Record<string, RawSchema>;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export class EndpointRegistry {
  readonly #client: SnowlineClient;
  readonly #ttlMs: number;
  readonly #basePath: string;
  #cache: { at: number; endpoints: Map<string, Endpoint> } | null = null;
  #inflight: Promise<Map<string, Endpoint>> | null = null;

  constructor(client: SnowlineClient, ttlMs: number) {
    this.#client = client;
    this.#ttlMs = ttlMs;

    // The base path (typically `/api`) is stripped from both sides so that
    // `/api/v1/x` and `/v1/x` resolve to the same endpoint.
    let basePath = "/";
    try {
      basePath = new URL(client.apiUrl).pathname.replace(/\/+$/, "");
    } catch {
      basePath = "/";
    }
    this.#basePath = basePath === "" ? "/" : basePath;
  }

  /** Collapses a caller-supplied path to the base-relative form used as the cache key. */
  normalizePath(input: string): string {
    let out = input.trim();
    if (out === "") return "";
    if (!out.startsWith("/")) out = `/${out}`;
    out = out.replace(/\/{2,}/g, "/");
    out = out.replace(/\/+$/, "");
    if (out === "") out = "/";

    if (this.#basePath !== "/" && out.startsWith(`${this.#basePath}/`)) {
      out = out.slice(this.#basePath.length);
    }
    return out;
  }

  /** Every callable endpoint, in stable path order. */
  async endpoints(): Promise<Endpoint[]> {
    const map = await this.#load();
    return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Resolves a caller-supplied path, or undefined when it is not published under /v1. */
  async resolve(input: string): Promise<Endpoint | undefined> {
    const normalized = this.normalizePath(input);
    if (!normalized.startsWith("/v1/")) return undefined;
    const map = await this.#load();
    return map.get(normalized);
  }

  async #load(): Promise<Map<string, Endpoint>> {
    const fresh =
      this.#cache !== null &&
      (this.#ttlMs === 0 ? false : Date.now() - this.#cache.at < this.#ttlMs);
    if (fresh && this.#cache) return this.#cache.endpoints;

    // Collapse concurrent first calls into one request.
    if (this.#inflight) return this.#inflight;

    this.#inflight = this.#fetch().finally(() => {
      this.#inflight = null;
    });

    return this.#inflight;
  }

  async #fetch(): Promise<Map<string, Endpoint>> {
    const raw = await this.#client.request("openapi");
    const endpoints = this.#parse(raw);
    this.#cache = { at: Date.now(), endpoints };
    return endpoints;
  }

  #parse(raw: unknown): Map<string, Endpoint> {
    const out = new Map<string, Endpoint>();
    if (!isRecord(raw)) return out;

    const doc = raw as RawDocument;
    const paths = isRecord(doc.paths) ? doc.paths : {};
    const sharedParams = isRecord(doc.components?.parameters)
      ? (doc.components?.parameters as Record<string, RawParameter>)
      : {};
    const schemas = isRecord(doc.components?.schemas)
      ? (doc.components?.schemas as Record<string, RawSchema>)
      : {};

    const derefParam = (param: RawParameter): RawParameter => {
      const ref = param.$ref;
      if (ref === undefined) return param;
      const key = ref.split("/").pop() ?? "";
      return sharedParams[key] ?? param;
    };

    const derefSchema = (schema: RawSchema | undefined): RawSchema => {
      if (!schema) return {};
      const ref = schema.$ref;
      if (ref === undefined) return schema;
      const key = ref.split("/").pop() ?? "";
      return schemas[key] ?? schema;
    };

    for (const [specPath, itemRaw] of Object.entries(paths)) {
      // Only GET is reachable, and only the versioned surface.
      const op = isRecord(itemRaw) ? (itemRaw as RawPathItem).get : undefined;
      if (!op || !isRecord(itemRaw)) continue;

      const normalized = this.normalizePath(specPath);
      if (!normalized.startsWith("/v1/")) continue;

      const seen = new Set<string>();
      const params: EndpointParam[] = [];

      const rawParams = [
        ...(Array.isArray((itemRaw as RawPathItem).parameters)
          ? ((itemRaw as RawPathItem).parameters as RawParameter[])
          : []),
        ...(Array.isArray(op.parameters) ? op.parameters : []),
      ];

      for (const rawParam of rawParams) {
        const param = derefParam(rawParam);
        const name = asString(param.name);
        const where = param.in === "path" ? "path" : param.in === "query" ? "query" : undefined;
        if (!name || !where) continue;

        const id = `${where}:${name}`;
        if (seen.has(id)) continue;
        seen.add(id);

        const schema = derefSchema(param.schema);
        const type =
          schema.type === "integer" || schema.type === "number" || schema.type === "boolean"
            ? schema.type
            : "string";

        const entry: EndpointParam = {
          name,
          in: where,
          required: param.required === true || where === "path",
          type,
        };

        const description = asString(param.description);
        if (description) entry.description = description;

        if (Array.isArray(schema.enum)) {
          const values = schema.enum.map((v) => String(v));
          if (values.length > 0) entry.enumValues = values;
        }

        const min = asNumber(schema.minimum);
        const max = asNumber(schema.maximum);
        const maxLen = asNumber(schema.maxLength);
        if (min !== undefined) entry.minimum = min;
        if (max !== undefined) entry.maximum = max;
        if (maxLen !== undefined) entry.maxLength = maxLen;

        if (["string", "number", "boolean"].includes(typeof schema.default)) {
          entry.defaultValue = schema.default as string | number | boolean;
        }

        params.push(entry);
      }

      out.set(normalized, {
        path: normalized,
        specPath,
        operationId: asString(op.operationId) ?? normalized,
        summary: asString(op.summary) ?? "",
        params,
      });
    }

    return out;
  }

  /** Throws unless every `{placeholder}` in the endpoint path has a safe value. */
  substitutePath(endpoint: Endpoint, pathParams: Record<string, string>): string {
    let path = endpoint.path;

    for (const param of endpoint.params) {
      if (param.in !== "path") continue;
      const token = `{${param.name}}`;
      const value = pathParams[param.name];

      if (value === undefined || value === "") {
        throw new SnowlineApiError({
          message: `Endpoint ${endpoint.path} requires a value for path parameter "${param.name}".`,
          status: 0,
          code: "missing_path_param",
          requestUrl: endpoint.specPath,
          resolution: `Pass path_params: { "${param.name}": "..." }.`,
        });
      }

      if (!/^[A-Za-z0-9][A-Za-z0-9._~@-]*$/.test(value)) {
        throw new SnowlineApiError({
          message: `Unsafe value for path parameter "${param.name}".`,
          status: 0,
          code: "invalid_path_param",
          requestUrl: endpoint.specPath,
          resolution: "Use only letters, digits, dot, dash, underscore, tilde or @.",
        });
      }

      path = path.replace(token, encodeURIComponent(value));
    }

    if (path.includes("{")) {
      throw new SnowlineApiError({
        message: `Endpoint ${endpoint.path} still has an unfilled placeholder.`,
        status: 0,
        code: "missing_path_param",
        requestUrl: endpoint.specPath,
      });
    }

    return path;
  }

  /**
   * Validates caller-supplied query values against the endpoint's declared
   * parameters and coerces them to the declared types.
   *
   * Undeclared keys are rejected rather than dropped: silently ignoring them
   * would let a caller believe a filter applied when it did not.
   */
  validateQuery(
    endpoint: Endpoint,
    query: Record<string, string | number | boolean>
  ): Record<string, string | number | boolean> {
    const declared = new Map(
      endpoint.params.filter((p) => p.in === "query").map((p) => [p.name, p])
    );

    const out: Record<string, string | number | boolean> = {};
    const unknown: string[] = [];

    for (const [key, rawValue] of Object.entries(query)) {
      const param = declared.get(key);
      if (!param) {
        unknown.push(key);
        continue;
      }
      out[key] = this.#coerce(endpoint, param, rawValue);
    }

    if (unknown.length > 0) {
      const allowed = [...declared.keys()];
      throw new SnowlineApiError({
        message: `Endpoint ${endpoint.path} declares no parameter(s): ${unknown.join(", ")}.`,
        status: 0,
        code: "undeclared_parameter",
        requestUrl: endpoint.specPath,
        resolution:
          allowed.length > 0
            ? `Declared parameters: ${allowed.join(", ")}.`
            : "This endpoint takes no query parameters.",
      });
    }

    for (const param of endpoint.params) {
      if (param.in === "query" && param.required && out[param.name] === undefined) {
        throw new SnowlineApiError({
          message: `Endpoint ${endpoint.path} requires query parameter "${param.name}".`,
          status: 0,
          code: "missing_parameter",
          requestUrl: endpoint.specPath,
          resolution: param.description ?? null,
        });
      }
    }

    return out;
  }

  #coerce(
    endpoint: Endpoint,
    param: EndpointParam,
    value: string | number | boolean
  ): string | number | boolean {
    const reject = (reason: string): never => {
      throw new SnowlineApiError({
        message: `Invalid value for "${param.name}": ${reason}`,
        status: 0,
        code: "invalid_parameter",
        requestUrl: endpoint.specPath,
        resolution:
          param.enumValues !== undefined
            ? `Allowed values: ${param.enumValues.join(", ")}.`
            : (param.description ?? null),
      });
    };

    if (param.enumValues !== undefined) {
      const asText = String(value);
      if (!param.enumValues.includes(asText)) {
        return reject(`expected one of ${param.enumValues.join(", ")}, received "${asText}"`);
      }
    }

    if (param.type === "integer" || param.type === "number") {
      const num = typeof value === "number" ? value : Number(String(value));
      if (!Number.isFinite(num)) return reject(`expected a number, received "${String(value)}"`);
      if (param.type === "integer" && !Number.isInteger(num)) {
        return reject(`expected an integer, received "${String(value)}"`);
      }
      if (param.minimum !== undefined && num < param.minimum) {
        return reject(`must be >= ${param.minimum}`);
      }
      if (param.maximum !== undefined && num > param.maximum) {
        return reject(`must be <= ${param.maximum}`);
      }
      return num;
    }

    if (param.type === "boolean") {
      if (typeof value === "boolean") return value;
      const text = String(value).toLowerCase();
      if (text === "true" || text === "1") return "true";
      if (text === "false" || text === "0") return "false";
      return reject(`expected a boolean, received "${String(value)}"`);
    }

    const text = String(value);
    if (param.maxLength !== undefined && text.length > param.maxLength) {
      return reject(`must be at most ${param.maxLength} characters`);
    }
    return text;
  }
}
