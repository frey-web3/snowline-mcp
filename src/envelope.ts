/**
 * Normalizes Snowline API responses into one predictable shape for agents.
 *
 * The rule that governs this file: **preserve the real contract**. The API
 * returns `meta.asOf`, `meta.stale`, `meta.source` and `meta.sources`, and a
 * `count` per collection — those are passed through untouched. Fields the API
 * does not return (a `total`, a `page`, a confidence score) are simply absent
 * rather than invented as `0` or `null`, so an agent can tell "no data" from
 * "not published".
 */

export interface SourceRef {
  key: string;
  name?: string;
  url?: string;
}

export interface SnowlineEnvelope<T> {
  /** The primary payload: a collection, a single record, or a named object. */
  data: T;
  /** Verbatim `meta` from the API, plus the count/limit actually applied. */
  meta: Record<string, unknown>;
  /** Flattened attribution, always an array so consumers need no branch. */
  sources: SourceRef[];
  /** `meta.asOf` (or the route timestamp) — when Snowline last verified this. */
  last_updated: string | null;
  /** Present on single-record responses: the §9 evidence projection. */
  evidence?: Evidence;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** Collect `meta.source` and `meta.sources` into a de-duplicated array. */
function collectSources(meta: Record<string, unknown>): SourceRef[] {
  const out: SourceRef[] = [];
  const seen = new Set<string>();

  const push = (raw: unknown): void => {
    if (!isRecord(raw)) {
      // `source` is occasionally a bare string.
      const key = asString(raw);
      if (key && !seen.has(key)) {
        seen.add(key);
        out.push({ key });
      }
      return;
    }
    const key = asString(raw.key) ?? asString(raw.name) ?? "unknown";
    const id = `${key}|${asString(raw.url) ?? ""}`;
    if (seen.has(id)) return;
    seen.add(id);

    const ref: SourceRef = { key };
    const name = asString(raw.name);
    const url = asString(raw.url);
    if (name) ref.name = name;
    if (url) ref.url = url;
    out.push(ref);
  };

  push(meta.source);

  const sources = meta.sources;
  if (Array.isArray(sources)) {
    for (const entry of sources) push(entry);
  } else {
    push(sources);
  }

  return out;
}

export interface EnvelopeOptions {
  /**
   * Key holding the primary payload. When omitted, the whole body becomes
   * `data` — correct for routes that return a single record or a bare object.
   */
  payloadKey?: string;
  /** Page size actually sent, echoed back so an agent can paginate safely. */
  limit?: number;
  /** Attach the §9 evidence projection for a single-record response. */
  evidence?: boolean;
}

export function buildEnvelope<T = unknown>(
  raw: unknown,
  options: EnvelopeOptions = {}
): SnowlineEnvelope<T> {
  if (!isRecord(raw)) {
    return { data: raw as T, meta: {}, sources: [], last_updated: null };
  }

  const rawMeta = isRecord(raw.meta) ? raw.meta : {};
  const meta: Record<string, unknown> = { ...rawMeta };

  if (typeof raw.count === "number") meta.count = raw.count;
  if (typeof raw.total === "number") meta.total = raw.total;
  if (options.limit !== undefined) meta.limit = options.limit;

  // `success: false` is surfaced rather than swallowed.
  if (raw.success === false) meta.success = false;
  if (isRecord(raw.error)) meta.error = raw.error;

  const data =
    options.payloadKey !== undefined && options.payloadKey in raw
      ? (raw[options.payloadKey] as T)
      : (raw as T);

  const lastUpdated =
    asString(rawMeta.asOf) ?? asString(raw.timestamp) ?? asString(raw.updatedAt) ?? null;

  const envelope: SnowlineEnvelope<T> = {
    data,
    meta,
    sources: collectSources(rawMeta),
    last_updated: lastUpdated,
  };

  if (options.evidence === true) {
    envelope.evidence = toEvidence(data);
  }

  return envelope;
}

/**
 * Cap a collection and record the fact, so an agent knows it saw a page and
 * not the whole set. The API caps `limit` at 100 anyway; this guards the
 * routes that ignore `limit` entirely.
 */
export function capList<T>(items: T[], limit: number): { items: T[]; capped: boolean } {
  if (!Array.isArray(items)) return { items: [], capped: false };
  if (items.length <= limit) return { items, capped: false };
  return { items: items.slice(0, limit), capped: true };
}

/**
 * Projects a Snowline record onto the evidence vocabulary agents reason about.
 *
 * Only fields the API actually returned are copied — an absent `publishedAt`
 * stays absent instead of becoming `null`, which would read as "verified none".
 */
export interface Evidence {
  name?: string;
  entity_type?: string;
  description?: string;
  category?: string;
  source_url?: string;
  published_at?: string;
  last_verified?: string;
  verification_status?: "verified" | "unverified";
  milestones?: string[];
  evidence?: string[];
}

export function toEvidence(item: unknown): Evidence {
  if (!isRecord(item)) return {};

  const out: Evidence = {};

  const name = asString(item.name) ?? asString(item.newsTitle) ?? asString(item.title);
  if (name) out.name = name;

  const entityType = asString(item.entityType) ?? asString(item.type);
  if (entityType) out.entity_type = entityType;

  const description =
    asString(item.shortDescription) ??
    asString(item.summary) ??
    asString(item.description) ??
    asString(item.bio);
  if (description) out.description = description;

  const category = asString(item.category) ?? asString(item.role);
  if (category) out.category = category;

  const sourceUrl = asString(item.sourceUrl) ?? asString(item.websiteUrl) ?? asString(item.officialUrl);
  if (sourceUrl) out.source_url = sourceUrl;

  const published = asString(item.publishedAt) ?? asString(item.date);
  if (published) out.published_at = published;

  const verifiedAt = asString(item.lastUpdated) ?? asString(item.verifiedAt);
  if (verifiedAt) out.last_verified = verifiedAt;

  if (typeof item.verified === "boolean") {
    out.verification_status = item.verified ? "verified" : "unverified";
  }

  // `sourceArticles` is the API's own list of supporting links for an update.
  if (Array.isArray(item.sourceArticles)) {
    const links = item.sourceArticles
      .map((a) => (isRecord(a) ? asString(a.url) ?? asString(a.sourceUrl) : asString(a)))
      .filter((v): v is string => Boolean(v));
    if (links.length > 0) out.evidence = links;
  }

  if (Array.isArray(item.keyPoints)) {
    const points = item.keyPoints.filter((v): v is string => typeof v === "string");
    if (points.length > 0) out.milestones = points;
  }

  return out;
}
