/**
 * End-to-end smoke test.
 *
 * Launches the built server over stdio exactly as an MCP client would, then
 * exercises every tool, resource and prompt. Read-only: it makes no assertion
 * about the content of Snowline's data, only that the protocol contract holds.
 *
 *   node scripts/smoke.mjs                     # against SNOWLINE_API_URL
 *   SNOWLINE_API_URL=http://127.0.0.1:3000/api node scripts/smoke.mjs
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
// SNOWLINE_MCP_ENTRY lets CI smoke-test an installed/packed copy instead of dist/.
const serverEntry =
  process.env.SNOWLINE_MCP_ENTRY ?? path.join(here, "..", "dist", "index.js");

const apiUrl = process.env.SNOWLINE_API_URL ?? "https://www.snowlineapp.xyz/api";

let pass = 0;
let fail = 0;

function check(label, condition, detail = "") {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function preview(result, max = 220) {
  const text = result?.content?.find((c) => c.type === "text")?.text ?? "";
  return text.replace(/\s+/g, " ").slice(0, max);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry],
  env: { ...process.env, SNOWLINE_API_URL: apiUrl, SNOWLINE_DEFAULT_LIMIT: "5" },
  stderr: "inherit",
});

const client = new Client({ name: "snowline-smoke", version: "1.0.0" });

console.log(`\n=== smoke test against ${apiUrl} ===\n`);
await client.connect(transport);
check("initialize / connect", true);

// ---------------------------------------------------------------- discovery
const tools = await client.listTools();
const toolNames = tools.tools.map((t) => t.name).sort();
console.log(`\n[tools] ${toolNames.length}: ${toolNames.join(", ")}`);

const expectedTools = [
  "snowline_local_api",
  "snowline_local_businesses",
  "snowline_local_builders",
  "snowline_local_chains",
  "snowline_local_latest_intel",
  "snowline_local_metrics",
  "snowline_local_network_stats",
  "snowline_local_projects",
  "snowline_local_search",
  "snowline_local_tokens",
];
for (const name of expectedTools) {
  check(`tool registered: ${name}`, toolNames.includes(name));
}

// The package's tools must not collide with the remote Snowline MCP server's
// names, so that a client can connect to both. These are the remote's tools.
const remoteToolNames = [
  "snowline_active_addresses", "snowline_avax_supply", "snowline_business",
  "snowline_chain_info", "snowline_chain_metrics", "snowline_chains",
  "snowline_erc20_balances", "snowline_get_blog_posts", "snowline_get_business_profile",
  "snowline_intel_address", "snowline_l1_chains", "snowline_latest_blocks",
  "snowline_latest_press_releases", "snowline_latest_transactions", "snowline_list_builders",
  "snowline_list_businesses", "snowline_list_projects", "snowline_list_updates",
  "snowline_metric_series", "snowline_native_balance", "snowline_nft_balances",
  "snowline_search_businesses", "snowline_search_intelligence", "snowline_search_token",
  "snowline_token_by_address", "snowline_top_whales", "snowline_tps",
  "snowline_trending_tokens",
];
const collisions = toolNames.filter((n) => remoteToolNames.includes(n));
check(
  `no tool-name collision with the remote MCP (${remoteToolNames.length} remote names)`,
  collisions.length === 0,
  `collides on: ${collisions.join(", ")}`
);
for (const tool of tools.tools) {
  check(
    `tool has description + schema: ${tool.name}`,
    typeof tool.description === "string" &&
      tool.description.length > 20 &&
      typeof tool.inputSchema === "object"
  );
}

const resources = await client.listResources();
console.log(
  `\n[resources] ${resources.resources.length}: ${resources.resources.map((r) => r.uri).join(", ")}`
);
for (const uri of [
  "snowline://businesses",
  "snowline://projects",
  "snowline://builders",
  "snowline://tokens",
  "snowline://chains",
  "snowline://network/stats",
  "snowline://intel/latest",
]) {
  check(`resource registered: ${uri}`, resources.resources.some((r) => r.uri === uri));
}

const prompts = await client.listPrompts();
console.log(
  `\n[prompts] ${prompts.prompts.length}: ${prompts.prompts.map((p) => p.name).join(", ")}`
);
for (const name of ["ecosystem_research", "business_discovery", "project_analysis"]) {
  check(`prompt registered: ${name}`, prompts.prompts.some((p) => p.name === name));
}

// -------------------------------------------------------------- tool calls
// Arguments are chosen to be valid for the *local* dataset; a tool that errors
// only because a specific slug is absent is still reported, not hidden.
const calls = [
  ["snowline_local_network_stats", {}],
  ["snowline_local_metrics", {}],
  ["snowline_local_metrics", { metric: "tps", range: "24h" }],
  ["snowline_local_metrics", { metric: "tps", latest: true }],
  ["snowline_local_businesses", { limit: 3 }],
  ["snowline_local_businesses", { q: "avalanche", limit: 3 }],
  ["snowline_local_businesses", { slug: "avalanche" }],
  ["snowline_local_projects", { limit: 3 }],
  ["snowline_local_projects", { q: "avalanche", limit: 3 }],
  ["snowline_local_builders", { limit: 3 }],
  ["snowline_local_tokens", { limit: 3 }],
  ["snowline_local_tokens", { slug: "AVAX" }],
  ["snowline_local_chains", { limit: 3 }],
  ["snowline_local_chains", { chainId: "4337" }],
  ["snowline_local_latest_intel", { limit: 3 }],
  ["snowline_local_latest_intel", { source: "updates", limit: 3 }],
  ["snowline_local_search", { query: "avalanche", limit: 3 }],
  ["snowline_local_search", { query: "avalanche", type: "businesses", limit: 3 }],
  ["snowline_local_search", { query: "avalanche", type: "projects", limit: 3 }],
];

console.log("\n[tool calls]");
for (const [name, args] of calls) {
  const label = `${name}(${JSON.stringify(args)})`;
  try {
    const result = await client.callTool({ name, arguments: args });
    const structured = result.structuredContent !== undefined;
    check(`${label} ok + structuredContent`, !result.isError && structured, preview(result));
    if (!result.isError) console.log(`         ${preview(result, 160)}`);
  } catch (error) {
    check(label, false, error.message);
  }
}

// ------------------------------------------- generic OpenAPI-driven tool
// This is the piece that lets a newly added endpoint be reached without
// republishing, so it gets the strictest attention: it must work, and it must
// refuse everything Snowline does not document.
console.log("\n[generic api tool]");

async function callApi(args, label) {
  try {
    return await client.callTool({ name: "snowline_local_api", arguments: args });
  } catch (error) {
    return { isError: true, thrown: error.message, label };
  }
}

const catalog = await callApi({});
const catalogRows = catalog.structuredContent?.data ?? [];
check(
  "no-arg call returns the endpoint catalog",
  !catalog.isError && Array.isArray(catalogRows) && catalogRows.length >= 10,
  `rows=${catalogRows.length}`
);
check(
  "catalog entries expose path, operation_id and summary",
  catalogRows.length > 0 &&
    catalogRows.every((r) => typeof r.path === "string" && typeof r.operation_id === "string"),
  JSON.stringify(catalogRows[0] ?? {})
);
check(
  "catalog only advertises /v1 endpoints",
  catalogRows.every((r) => String(r.path).startsWith("/api/v1/")),
  catalogRows.find((r) => !String(r.path).startsWith("/api/v1/"))?.path
);

const direct = await callApi({ path: "/api/v1/businesses", query: { limit: 2 } });
check(
  "calls a documented endpoint (spec form)",
  !direct.isError && Array.isArray(direct.structuredContent?.data?.businesses),
  preview(direct)
);

const relativeForm = await callApi({ path: "/v1/businesses", query: { limit: 2 } });
check(
  "accepts the base-relative path form too",
  !relativeForm.isError && Array.isArray(relativeForm.structuredContent?.data?.businesses),
  preview(relativeForm)
);

// Documented boundary, deliberately asserted: the API serves several working
// routes that its OpenAPI document omits (e.g. /api/v1/avax/l1-chains). The
// generic tool is gated on the document, so it refuses them — the curated
// snowline_local_chains tool covers that one instead.
const undocumented = await callApi({ path: "/api/v1/avax/l1-chains", query: { limit: 2 } });
check(
  "refuses a working-but-undocumented route (document is the allow-list)",
  undocumented.isError === true && /not an endpoint/i.test(preview(undocumented)),
  preview(undocumented)
);

const curatedCoversGap = await client.callTool({
  name: "snowline_local_chains",
  arguments: { chainId: "4337" },
});
check(
  "curated tool still reaches that route",
  !curatedCoversGap.isError && curatedCoversGap.structuredContent?.data?.length === 1,
  preview(curatedCoversGap)
);

const withParam = await callApi({
  path: "/api/v1/businesses/{slug}",
  path_params: { slug: "avalanche" },
});
check(
  "substitutes {path_params}",
  !withParam.isError && withParam.structuredContent?.data?.business?.slug === "avalanche",
  preview(withParam)
);

const unknown = await callApi({ path: "/api/v1/totally-made-up" });
check("refuses an endpoint Snowline does not document", unknown.isError === true, preview(unknown));

const legacy = await callApi({ path: "/api/businesses" });
check("refuses the legacy non-/v1 surface", legacy.isError === true, preview(legacy));

const undeclared = await callApi({ path: "/api/v1/stats", query: { bogus: "1" } });
check(
  "refuses an undeclared query parameter (does not silently drop it)",
  undeclared.isError === true && /declares no parameter/i.test(preview(undeclared)),
  preview(undeclared)
);

const traversal = await callApi({
  path: "/api/v1/businesses/{slug}",
  path_params: { slug: "../../admin" },
});
check("refuses path traversal in path_params", traversal.isError === true, preview(traversal));

const badEnum = await callApi({
  path: "/api/v1/metrics/{metric}",
  path_params: { metric: "tps" },
  query: { range: "99d" },
});
check(
  "enforces declared enums (range=99d rejected)",
  badEnum.isError === true && /99d/.test(preview(badEnum)),
  preview(badEnum)
);

const missingParam = await callApi({ path: "/api/v1/businesses/{slug}" });
check("requires a value for every {placeholder}", missingParam.isError === true, preview(missingParam));

// ----------------------------------------------------- validation + errors
console.log("\n[validation]");
try {
  const bad = await client.callTool({
    name: "snowline_local_businesses",
    arguments: { slug: "../../etc/passwd" },
  });
  check("rejects a path-traversal slug", bad.isError === true, preview(bad));
} catch (error) {
  check("rejects a path-traversal slug", true, `rejected by schema: ${error.message.slice(0, 80)}`);
}

try {
  const bad = await client.callTool({
    name: "snowline_local_tokens",
    arguments: { addresses: ["not-an-address"] },
  });
  check("rejects a malformed EVM address", bad.isError === true, preview(bad));
} catch (error) {
  check("rejects a malformed EVM address", true, `rejected by schema: ${error.message.slice(0, 80)}`);
}

try {
  const bad = await client.callTool({
    name: "snowline_local_businesses",
    arguments: { limit: 5000 },
  });
  check("rejects limit above the API ceiling", bad.isError === true, preview(bad));
} catch (error) {
  check("rejects limit above the API ceiling", true, `rejected by schema: ${error.message.slice(0, 80)}`);
}

try {
  const missing = await client.callTool({
    name: "snowline_local_businesses",
    arguments: { slug: "definitely-not-a-real-slug-xyz" },
  });
  check("returns isError (not a throw) for an unknown slug", missing.isError === true, preview(missing));
} catch (error) {
  check("returns isError (not a throw) for an unknown slug", false, error.message);
}

try {
  const unknown = await client.callTool({ name: "snowline_does_not_exist", arguments: {} });
  check("unknown tool is refused", unknown.isError === true, preview(unknown));
} catch (error) {
  check("unknown tool is refused", true, `rejected: ${error.message.slice(0, 60)}`);
}

// ------------------------------------------------------------ resources
console.log("\n[resource reads]");
for (const uri of [
  "snowline://businesses",
  "snowline://projects",
  "snowline://builders",
  "snowline://tokens",
  "snowline://chains",
  "snowline://network/stats",
  "snowline://intel/latest",
]) {
  try {
    const read = await client.readResource({ uri });
    const first = read.contents?.[0];
    let parsed = false;
    try {
      const json = JSON.parse(first?.text ?? "");
      parsed = Array.isArray(json.data) || typeof json.data === "object";
    } catch {
      parsed = false;
    }
    check(`read ${uri} -> JSON envelope`, parsed, first?.mimeType);
  } catch (error) {
    check(`read ${uri}`, false, error.message);
  }
}

// --------------------------------------------------------------- prompts
console.log("\n[prompt retrieval]");
const promptCalls = [
  ["ecosystem_research", {}],
  ["ecosystem_research", { topic: "gaming L1s", depth: "deep" }],
  ["business_discovery", { sector: "DeFi & Infrastructure" }],
  ["project_analysis", { project: "Team1FR" }],
];
for (const [name, args] of promptCalls) {
  try {
    const got = await client.getPrompt({ name, arguments: args });
    const text = got.messages?.[0]?.content?.text ?? "";
    check(`${name}(${JSON.stringify(args)}) -> ${text.length} chars`, text.length > 200);
  } catch (error) {
    check(`${name}(${JSON.stringify(args)})`, false, error.message);
  }
}

await client.close();

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
process.exit(fail === 0 ? 0 : 1);
