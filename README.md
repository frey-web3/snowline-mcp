# snowline-mcp

**Model Context Protocol server for [Snowline](https://www.snowlineapp.xyz)** — the Avalanche ecosystem
intelligence API. Connect Claude, Cursor, VS Code, Windsurf, OpenCode or any MCP-capable agent to
verified data on Avalanche businesses, projects, builders, tokens, L1 chains, network metrics and
ecosystem milestones.

```bash
npx -y snowline-mcp
```

One API → one integration layer → many AI clients. This package contains **no database and no business
logic**: every call is proxied to the Snowline REST API, which stays the single source of truth. When
Snowline adds a business, project, token or metric, every connected client sees it with no upgrade.

---

## 1. What is Snowline MCP?

Snowline tracks the Avalanche ecosystem — the companies building on it, the projects and dApps, the
people behind them, the tokens trading on it, the L1 subnets running on it, and the network's live
metrics. This package exposes that data to AI agents as MCP **tools**, **resources** and **prompts**,
so an agent can answer questions with real records and citations instead of recollection.

There are two ways to connect, and they are independent:

| Method | Transport | Best for |
|---|---|---|
| **Remote MCP** | Streamable HTTP | Clients that support remote servers — no install |
| **This npm package** | stdio (local) | Clients that launch a local process, or where you want to pin a specific API base |

Both read the same Snowline API. Neither one owns the data.

## 2. Features

- **10 tools** covering search, businesses, projects, builders, tokens, L1 chains, network stats, metric
  time series and latest intel.
- **7 resources** for zero-call context loading.
- **3 prompts** that steer an agent toward evidence rather than token hype.
- **One normalized envelope** (`data` / `meta` / `sources` / `last_updated`) with the API's real
  `meta`, `count` and attribution preserved — nothing is invented.
- **Staleness is surfaced, not hidden.** `meta.stale` and `meta.asOf` pass straight through, and the
  human-readable summary warns when a snapshot is stale.
- **Partial results are labelled.** Collections the API cannot filter are marked
  `meta.filtered_client_side` with a `meta.scanned` count, so an agent never reads a page as an index.
- **Zod-validated inputs** and **allow-listed routes** — a model cannot drive the server at an
  arbitrary URL or path.
- **Structured + readable output**: every tool returns MCP `structuredContent` plus a text digest.
- **No credentials required.** Snowline's public endpoints need no API key.

## 3. Supported tools

All tools are prefixed **`snowline_local_`** so this server can run alongside the remote Snowline MCP
server (whose tools are unprefixed) without a single name collision. Verified: the remote server
exposes 28 tools, none of which share a name with these 10.

| Tool | What it does |
|---|---|
| `snowline_local_search` | One entry point across the ecosystem. `type: 'all'` uses Snowline's own search (businesses + updates); other types scan locally and are marked partial. Start here when you know a name but not a slug. |
| `snowline_local_businesses` | Verified businesses and enterprises. List/filter by `q`, `ticker`, `category`, or pass `slug` for a full profile. |
| `snowline_local_projects` | Ecosystem projects and dApps. `category` filters server-side; `q` matches locally (the route has no search). |
| `snowline_local_builders` | Builders, founders and contributors — role, category, `verified` flag and linked accounts. |
| `snowline_local_tokens` | Token intelligence from live DexScreener data. Profile by symbol/address, batch-resolve `addresses`, or read the trending list. |
| `snowline_local_chains` | Avalanche L1 (subnet) directory with live per-chain telemetry: blocks, 24h transactions, TPS, active addresses, fees, RPC and explorer. |
| `snowline_local_network_stats` | The C-Chain snapshot: block height, transactions, TPS, active addresses, **validator count**, gas, fees, supply and staking. |
| `snowline_local_metrics` | Metric catalog plus historical time series. Discover valid metric keys, then pull a series over `24h`/`7d`/`30d`/`90d` or just the latest point. |
| `snowline_local_latest_intel` | Recent ecosystem intelligence: builder/company updates and press releases, with `publishedAt`, `sourceUrl` and `sourceArticles`. Local date-range filtering. |
| `snowline_local_api` | **The escape hatch.** Calls any endpoint Snowline documents under `/v1` — including ones added *after* this package was released. Call it with no `path` to list every endpoint. See §16. |

### Two honest deviations from a naive tool list

- **There is no `snowline_local_validators` tool.** Snowline publishes no validators route — every
  candidate path returns 404. The only validator datum the API exposes is `validatorCount`, which
  `snowline_local_network_stats` already returns in full (`totalStaked`, `validatorCount`).
  `snowline_local_metrics` was added in its place because that is where staking and validator-related
  series actually live.
- **There is no `page` parameter anywhere.** The Snowline API is `limit`-based (`limit` 1–100) with a
  cursor only on the address transaction feed. Adding a `page` argument would have meant inventing an
  API contract, so the tools expose `limit` and say so.

## 4. Supported resources

| URI | Content |
|---|---|
| `snowline://businesses` | Tracked businesses with classification, market cap and links |
| `snowline://projects` | Ecosystem projects with category and verification status |
| `snowline://builders` | Ecosystem builders and contributors |
| `snowline://tokens` | Trending tokens with live market data |
| `snowline://chains` | L1 chains with live telemetry |
| `snowline://network/stats` | Latest C-Chain snapshot |
| `snowline://intel/latest` | Recent updates with dates and sources |

Resources are bounded to 50 records and returned as a JSON envelope. There is deliberately no
`snowline://validators` — a URI that cannot be read is worse than one that does not exist.

## 5. Supported prompts

| Prompt | Purpose |
|---|---|
| `ecosystem_research` | Produce an evidence-based brief on Avalanche activity, citing sources and separating verified facts from announcements. Args: `topic`, `depth`. |
| `business_discovery` | Find businesses with real adoption. Args: `sector`, `limit`. |
| `project_analysis` | Analyse one project from its profile, activity and milestones. Args: `project`, `question`. |

Each prompt instructs the agent to cite `sourceUrl`/`sourceArticles`, to label `verified: false` records
as unverified rather than dropping them, to report `priceAsOf` with any price, and **not** to treat a
token price rise or a marketing announcement as evidence of adoption.

## 6. Installation

Run directly — no install required:

```bash
npx -y snowline-mcp
```

Or install globally:

```bash
npm install -g snowline-mcp
```

The server speaks MCP on **stdio** and is meant to be launched by an MCP client, not run by hand.
To inspect it:

```bash
npx -y snowline-mcp --help
npx -y snowline-mcp --version
```

Requires **Node.js 20 or newer**.

> Prefer not to configure anything by hand? The repository is also a **portable plugin** that installs
> both this server and the remote endpoint in one step, for Devin, Claude Code, Cursor and any other
> Agent Plugins client. See [§17](#17-install-as-a-plugin).

## 7. Cursor

`.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global):

```json
{
  "mcpServers": {
    "snowline": {
      "command": "npx",
      "args": ["-y", "snowline-mcp"]
    }
  }
}
```

## 8. Claude Code

```bash
claude mcp add snowline -- npx -y snowline-mcp
```

For a project-scoped server add `--scope project`. To point at a non-default API:

```bash
claude mcp add snowline --env SNOWLINE_API_URL=http://localhost:3000/api -- npx -y snowline-mcp
```

## 9. OpenCode

In `opencode.json` (project root) or `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "snowline": {
      "type": "local",
      "command": ["npx", "-y", "snowline-mcp"],
      "enabled": true
    }
  }
}
```

## 10. Remote MCP

If your client supports remote Streamable HTTP, skip the install entirely. This matches the
configuration Snowline publishes on [its MCP page](https://www.snowlineapp.xyz/mcp):

```json
{
  "mcpServers": {
    "snowline": {
      "url": "https://www.snowlineapp.xyz/api/mcp",
      "type": "streamable-http"
    }
  }
}
```

Raw JSON-RPC also works:

```bash
curl -X POST https://www.snowlineapp.xyz/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## 11. Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `SNOWLINE_API_URL` | `https://www.snowlineapp.xyz/api` | API base URL |
| `SNOWLINE_API_KEY` | *(unset)* | Optional bearer token. Public endpoints need none |
| `SNOWLINE_TIMEOUT_MS` | `20000` | Per-request timeout (1000–120000) |
| `SNOWLINE_MAX_RESPONSE_BYTES` | `2000000` | Response size cap; oversized bodies are rejected, not truncated |
| `SNOWLINE_DEFAULT_LIMIT` | `20` | Records per call when `limit` is omitted |
| `SNOWLINE_MAX_LIMIT` | `100` | Upper bound a tool may request |
| `SNOWLINE_OPENAPI_TTL_MS` | `600000` | How long `snowline_local_api` caches Snowline's endpoint catalog. `0` refetches every call |

Example, pointed at a local dev server:

```json
{
  "mcpServers": {
    "snowline": {
      "command": "npx",
      "args": ["-y", "snowline-mcp"],
      "env": { "SNOWLINE_API_URL": "http://localhost:3000/api" }
    }
  }
}
```

## 12. API authentication

**None is required.** Snowline's public API declares `security: []` and no security schemes
([OpenAPI](https://www.snowlineapp.xyz/api/openapi.json)), and its documentation states that no API
keys are needed. `SNOWLINE_API_KEY` exists only to talk to a private deployment; when set it is sent as
`Authorization: Bearer <key>` and is never logged, never written into a URL, and never included in an
error message.

Public responses are CDN-cached and transport rate-limited. On a `429` the server surfaces the RFC 7807
problem body and the `Retry-After` value to the calling model.

## 13. Troubleshooting

**`402 Payment required` / `DEPLOYMENT_DISABLED`**
The Snowline Vercel deployment is disabled, so *every* route — website, API and remote MCP — returns
402. This is a hosting state, not a package problem. Confirm with
`curl -i https://www.snowlineapp.xyz/api/health`. Point `SNOWLINE_API_URL` at a running deployment
(or `http://localhost:3000/api`) to keep working.

**The client shows no tools.**
The server writes its diagnostics to **stderr** and reserves **stdout** for JSON-RPC — that is
correct, and it means a broken pipe or a stray `console.log` would be the cause if tools vanish.
Check the client's MCP log, then run `npx -y snowline-mcp --help` to confirm the binary starts.

**`Invalid configuration` on startup.**
`SNOWLINE_API_URL` must be an absolute `http`/`https` URL, and the numeric variables must be integers in
range. The message names the offending variable.

**`No record matched` (404).**
Slugs are exact. Call `snowline_local_search` first to resolve the right one — do not guess a slug.

**Results look partial.**
Check `meta.filtered_client_side`. When true, the API has no filter for that collection and only
`meta.scanned` records were examined. Narrow the query or use a slug.

**`response_too_large`.**
The body exceeded `SNOWLINE_MAX_RESPONSE_BYTES`. Lower `limit`, add a filter, or request a single
record by slug. The body is rejected rather than silently truncated, so an agent never parses a
half-document.

**Data looks old.**
Check `meta.asOf` and `meta.stale`. Snowline flags snapshots it has not refreshed, and the summary line
prints a `WARNING` when `stale` is true.

**Rate limited.**
Wait for the `Retry-After` interval reported on the error, then retry.

## 14. Links

- Website — <https://www.snowlineapp.xyz>
- MCP page — <https://www.snowlineapp.xyz/mcp>
- Remote MCP endpoint — <https://www.snowlineapp.xyz/api/mcp>
- OpenAPI document — <https://www.snowlineapp.xyz/api/openapi.json>
- API base — <https://www.snowlineapp.xyz/api>
- Source — <https://github.com/frey-web3/snowline-mcp>

## 15. Adding a new API endpoint later

This is the question that decides how much maintenance you sign up for, so it is worth being precise.

**Adding an endpoint to the app does not, on its own, require a new npm release.** `snowline_local_api`
re-reads Snowline's OpenAPI document (cached for `SNOWLINE_OPENAPI_TTL_MS`, default 10 minutes), so any
endpoint that appears in that document is callable through it the next time the process starts —
no republish, no version bump.

What each change costs:

| You want to… | Edit | Publish npm? |
|---|---|---|
| Add an endpoint and make it usable by agents immediately | app route **+ add it to `public/openapi.json`** | **No** — `snowline_local_api` picks it up |
| Give it a curated tool (better descriptions, local filtering, honest partial-result labelling) | `src/client.ts` `ROUTES` (1 line) + a file in `src/tools/` | **Yes** — `npm version patch && npm publish` |
| Expose it on the **remote** MCP as well | `lib/mcp-server.ts` in the app (manifest + `executeMcpTool`) | No — that surface is served by the app |

So the practical rule: **document the endpoint and it is free; curate it and you publish.** If you add a
route but forget `openapi.json`, agents cannot reach it through the generic tool — and that is exactly
the state of the six `avax/*` endpoints today (see the note below).

### Known gap: 14 working routes are missing from `openapi.json`

Verified against the app on 2026-11-03: of 40 route files under `src/app/api/v1`, **26 are in
`openapi.json` and 14 are not**. The absent ones include genuinely useful public data:

```text
/api/v1/avax/block              /api/v1/avax/chain-stats      /api/v1/avax/l1-chains
/api/v1/avax/market-chart       /api/v1/avax/stats-history    /api/v1/avax/trending-tokens
/api/v1/intel/addresses/lookup  /api/v1/intel/entities        /api/v1/intel/entities/{slug}
/api/v1/intel/resolve           /api/v1/intel/search          /api/v1/intel/tokens/sync
/api/v1/intel/tracked-addresses /api/v1/intel/usage
```

Some of the `intel/*` ones are plausibly internal (sync, usage), but the six `avax/*` routes serve
public market and chain data. Because `snowline_local_api` treats the document as the allow-list, it
refuses them. The curated tools still reach the two that matter (`snowline_local_chains`,
`snowline_local_network_stats`) because those paths are in the hand-written `ROUTES` table.

**Recommended fix:** add the six `avax/*` routes to `public/openapi.json`. That closes the gap for
every client at once — this package, the remote MCP and any third-party consumer — with no npm release.

## 16. Where each artifact lives

| Artifact | Goes to | Notes |
|---|---|---|
| Built `dist/` | **npm** — `npm publish` from this directory | `files` limits the tarball to `dist`, README and LICENSE |
| `src/` | **GitHub `frey-web3/snowline-mcp`** | make this repo public; `dist/` is gitignored |
| The app | **GitHub `frey-web3/snowline`** | already ignores `/snowline-mcp/`, so the package never lands in the app repo |

npm receives the compiled output; GitHub receives the source. Editing `src/` alone changes nothing for
`npx` users until you publish.

## 17. Install as a plugin

This repository **is** a plugin as well as an npm package. One directory satisfies three ecosystems at
once, because Devin reads the Claude layout and the Agent Plugins layout, and Cursor loads Agent
Plugins natively:

| Manifest | Read by |
|---|---|
| `plugin.json` + `mcp.json` | **Agent Plugins 1.0.0** — Cursor, VS Code, GitHub Copilot, ChatGPT & Codex, Kiro, Hermes, OpenClaw, Grok Bot, NanoClaw, OpenHands, Perplexity |
| `.claude-plugin/plugin.json` + `.mcp.json` | **Claude Code**, and **Devin** (falls back to this when `.devin-plugin/` is absent) |
| `.claude-plugin/marketplace.json` | **Claude Code** marketplace listing |

Devin resolves manifests in the order `.devin-plugin/plugin.json` > `.claude-plugin/plugin.json` >
`plugin.json`, so no Devin-specific manifest is needed.

### Install

**Claude Code** — via its own marketplace:

```bash
claude plugin marketplace add frey-web3/snowline-mcp
claude plugin install snowline-mcp@snowline
```

Or straight from a local clone, for one session, with no marketplace:

```bash
claude --plugin-dir ./snowline-mcp
```

**Devin** — the CLI installs from the repo directly:

```bash
devin plugins install frey-web3/snowline-mcp
```

**Cursor / VS Code / other Agent Plugins clients** — add the repository as an Agent Plugin. Cursor
also accepts plugins through **Customize → Plugins** or the Cursor Marketplace (which is
human-reviewed; see <https://cursor.com/docs/plugins>).

### What the plugin declares: both connection methods

`mcp.json` and `.mcp.json` are kept identical and declare **two** servers:

```json
{
  "mcpServers": {
    "snowline-local": { "type": "stdio", "command": "npx", "args": ["-y", "snowline-mcp"] },
    "snowline-remote": { "type": "streamable-http", "url": "https://www.snowlineapp.xyz/api/mcp" }
  }
}
```

- `snowline-local` runs the npm package on the user's machine — 10 curated tools.
- `snowline-remote` talks to Snowline's remote MCP endpoint — 28 tools.

**A client that supports both transports will load both**, giving 38 tools. That is safe — the local
tools are prefixed `snowline_local_`, so nothing is shadowed — but it is a lot of tools. To ship only
one, delete the other entry from **both** `mcp.json` and `.mcp.json` and run
`npm run validate:plugin`; the validator fails if the two files drift apart, because Devin gives
`.mcp.json` precedence and would otherwise apply a different set than Cursor.

A bundled skill, [`skills/snowline-ecosystem/SKILL.md`](snowline-mcp/skills/snowline-ecosystem/SKILL.md),
teaches the agent which tool to reach for and the evidence rules — cite sources, report `priceAsOf` and
`meta.asOf`, respect the `verified` flag, and treat partial results as partial.

### Verification status

`npm run validate:plugin` checks every file against the official
[Agent Plugins 1.0.0 JSON Schemas](https://agent-plugins.org/schemas) and the documented Claude Code
rules — **33 checks**, offline. Both schemas are `additionalProperties: false`, so an extra or
misspelled key silently disables a component; that is what the validator catches.

What has **not** been run, because the vendor CLIs are not installed here — do these before announcing
the plugin:

```bash
claude plugin validate ./snowline-mcp     # Claude Code
devin plugins install --local ./snowline-mcp   # Devin
```

Also note the `marketplace.json` entry points at `frey-web3/snowline-mcp` with a `github` source, so the
2.0.0 work must be **pushed** before `claude plugin marketplace add` can install anything.

---

## Development

```bash
npm install
npm run build            # tsc -> dist/
npm run typecheck        # tsc --noEmit
npm run dev              # tsx src/index.ts
npm run smoke            # end-to-end MCP test against SNOWLINE_API_URL
npm run validate:plugin  # check the plugin packaging, offline
```

The smoke test drives the built server over stdio as a real MCP client would: it lists tools,
resources and prompts, calls every tool, and asserts that bad input (path traversal, a malformed
address, an out-of-range limit) is rejected and that a missing record returns `isError` rather than
throwing.

```bash
SNOWLINE_API_URL=http://localhost:3000/api npm run smoke
```

### Layout

```text
src/
  index.ts        CLI entry (shebang, stdio transport, --help)
  server.ts       registers every tool, resource and prompt
  client.ts       allow-listed API client: timeout, size caps, error mapping
  config.ts       environment parsing and validation
  envelope.ts     response normalization; real contracts only
  openapi.ts      endpoint registry: reads the OpenAPI document, gates snowline_local_api
  tools/          10 tools
  resources/      7 resources across 4 modules
  prompts/        3 prompts

plugin.json                    Agent Plugins manifest (Cursor, VS Code, Copilot, Codex, ...)
mcp.json                       Agent Plugins MCP servers
.claude-plugin/plugin.json     Claude Code + Devin manifest
.claude-plugin/marketplace.json Claude Code marketplace listing
.mcp.json                      Claude Code + Devin MCP servers
skills/snowline-ecosystem/     bundled Agent Skill

scripts/          smoke.mjs, validate-plugin.mjs
```

The plugin files live at the repository root but are **not** published to npm — `files` limits the
tarball to `dist`, README and LICENSE, and the validator asserts that.

### Publishing

```bash
npm run build
npm pack --dry-run     # verify only dist/, README.md and LICENSE ship
npm publish
```

`files` limits the tarball to `dist`, `README.md` and `LICENSE`.

## Design notes

**Routes are allow-listed, not constructed — with two independent guards.**
Curated tools go through a frozen `ROUTES` table in `src/client.ts`: a tool selects a *key*, so no code
path builds a URL from model output. `snowline_local_api` is the one place a model-influenced path
reaches a URL, and it is gated twice: `EndpointRegistry` matches the path against Snowline's own
published document (an exact match on the documented path set, restricted to `/v1/`), and
`client.requestPath()` independently rejects traversal sequences, absolute URLs and anything outside
`/v1/`. Undeclared query keys are rejected rather than dropped, so a caller can never believe a filter
applied when it did not. Combined with the slug and address regexes, that closes off path traversal and
SSRF by construction rather than by validation alone.

**Retrieved content is treated as data.** Tool output is data returned to the model. The server
instructions state this explicitly, because Snowline records contain third-party text.

**The envelope never fabricates.** The API returns no `total` and no `page`, so the envelope has
neither. `count`, `meta.asOf`, `meta.stale` and `meta.sources` come through verbatim, and an absent
field stays absent so that "not published" cannot be misread as "zero".

## License

MIT
