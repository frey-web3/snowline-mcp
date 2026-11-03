/**
 * Validates the plugin packaging without needing any vendor CLI installed.
 *
 * The rules below are transcribed from the two authoritative sources:
 *   - Agent Plugins 1.0.0 — https://agent-plugins.org/schemas/1.0.0/{plugin,mcp}.schema.json
 *   - Claude Code plugin docs — https://code.claude.com/docs/en/plugins/
 *
 * Both schemas are `additionalProperties: false`, so an extra key is a real
 * defect, not a style nit; a typo in a field name silently disables a
 * component. That is what this catches.
 *
 *   node scripts/validate-plugin.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
let checks = 0;

function ok(label) {
  checks += 1;
  console.log(`  PASS  ${label}`);
}

function bad(label, detail) {
  checks += 1;
  failures += 1;
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
}

function check(label, condition, detail) {
  if (condition) ok(label);
  else bad(label, detail);
}

function readJson(rel) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    bad(`${rel} parses as JSON`, error.message);
    return null;
  }
}

const AGENT_SCHEMA = "https://agent-plugins.org/schemas/1.0.0";
const PLUGIN_KEYS = new Set([
  "$schema", "name", "version", "description", "author",
  "homepage", "repository", "license", "keywords", "extensions",
]);
const AUTHOR_KEYS = new Set(["name", "email", "url"]);
const CLAUDE_KEYS = new Set([
  "name", "version", "description", "author", "homepage", "repository", "license",
  "keywords", "commands", "agents", "skills", "hooks", "mcpServers", "lspServers",
  "userConfig", "settings", "channels", "outputStyles", "experimental",
]);

const SERVER_SHAPES = {
  stdio: { required: ["type", "command"], allowed: new Set(["type", "command", "args", "env", "cwd"]) },
  "streamable-http": { required: ["type", "url"], allowed: new Set(["type", "url", "headers"]) },
  sse: { required: ["type", "url"], allowed: new Set(["type", "url", "headers"]) },
};

function validateServerShape(label, name, server, { requireType }) {
  if (typeof server !== "object" || server === null) {
    bad(`${label}: "${name}" is an object`, typeof server);
    return;
  }

  if (requireType && server.type === undefined) {
    bad(`${label}: "${name}" declares a type`, "an entry with a url but no type is read as stdio and fails");
    return;
  }

  const shape = SERVER_SHAPES[server.type];
  if (!shape) {
    bad(`${label}: "${name}" has a known type`, `got ${JSON.stringify(server.type)}`);
    return;
  }

  for (const key of shape.required) {
    if (server[key] === undefined) bad(`${label}: "${name}" has required "${key}"`);
  }

  const unknown = Object.keys(server).filter((k) => !shape.allowed.has(k));
  check(`${label}: "${name}" has no unknown keys`, unknown.length === 0, unknown.join(", "));

  if (server.type === "stdio") {
    check(
      `${label}: "${name}" command is a single executable token`,
      typeof server.command === "string" && !/\s/.test(server.command),
      JSON.stringify(server.command)
    );
    if (server.env) {
      const reserved = Object.keys(server.env).filter((k) => k === "PLUGIN_ROOT" || k === "PLUGIN_DATA");
      check(`${label}: "${name}" sets no reserved env keys`, reserved.length === 0, reserved.join(", "));
    }
  }

  if (server.type !== "stdio") {
    check(
      `${label}: "${name}" url is https`,
      typeof server.url === "string" && server.url.startsWith("https://"),
      server.url
    );
    if (server.headers) {
      // The spec forbids credentials in headers: they are literal package data.
      const suspicious = Object.entries(server.headers).filter(([k, v]) =>
        /authorization|api[-_]?key|token|secret|cookie/i.test(`${k} ${v}`)
      );
      check(`${label}: "${name}" headers carry no credentials`, suspicious.length === 0, JSON.stringify(suspicious));
    }
  }
}

console.log("\n=== plugin.json (Agent Plugins 1.0.0) ===");
const plugin = readJson("plugin.json");
if (plugin) {
  check("$schema is the canonical 1.0.0 identifier", plugin.$schema === `${AGENT_SCHEMA}/plugin.schema.json`, plugin.$schema);
  check("name is present", typeof plugin.name === "string" && plugin.name.length > 0);
  check(
    "name satisfies the schema pattern (lowercase, no '--', no '..', <=64)",
    typeof plugin.name === "string" &&
      plugin.name.length <= 64 &&
      !plugin.name.includes("--") &&
      !plugin.name.includes("..") &&
      /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(plugin.name),
    plugin.name
  );
  const unknown = Object.keys(plugin).filter((k) => !PLUGIN_KEYS.has(k));
  check("no unknown top-level keys (schema is closed)", unknown.length === 0, unknown.join(", "));
  if (plugin.author) {
    const badAuthor = Object.keys(plugin.author).filter((k) => !AUTHOR_KEYS.has(k));
    check("author has only name/email/url", badAuthor.length === 0, badAuthor.join(", "));
  }
}

console.log("\n=== mcp.json (Agent Plugins 1.0.0) ===");
const mcp = readJson("mcp.json");
if (mcp) {
  check("$schema is the canonical 1.0.0 identifier", mcp.$schema === `${AGENT_SCHEMA}/mcp.schema.json`, mcp.$schema);
  const extra = Object.keys(mcp).filter((k) => k !== "$schema" && k !== "mcpServers");
  check("only $schema and mcpServers at the top level", extra.length === 0, extra.join(", "));
  const servers = mcp.mcpServers ?? {};
  check("declares at least one server", Object.keys(servers).length > 0);
  for (const [name, server] of Object.entries(servers)) {
    validateServerShape("mcp.json", name, server, { requireType: true });
  }
}

console.log("\n=== .claude-plugin/plugin.json (Claude Code) ===");
const claude = readJson(".claude-plugin/plugin.json");
if (claude) {
  check("name is present", typeof claude.name === "string" && claude.name.length > 0);
  const unknown = Object.keys(claude).filter((k) => !CLAUDE_KEYS.has(k));
  check("no unknown manifest keys", unknown.length === 0, unknown.join(", "));
  if (claude.author) {
    const badAuthor = Object.keys(claude.author).filter((k) => !AUTHOR_KEYS.has(k));
    check("author has only name/email/url", badAuthor.length === 0, badAuthor.join(", "));
  }
  if (plugin) {
    check(
      "manifest name matches the Agent Plugins name",
      claude.name === plugin.name,
      `${claude.name} vs ${plugin.name}`
    );
  }
}

console.log("\n=== .mcp.json (Claude Code / Devin) ===");
const claudeMcp = readJson(".mcp.json");
if (claudeMcp) {
  const servers = claudeMcp.mcpServers ?? {};
  check("declares mcpServers", Object.keys(servers).length > 0);
  for (const [name, server] of Object.entries(servers)) {
    // Claude reads a url entry with no type as stdio; that is the documented failure.
    validateServerShape(".mcp.json", name, server, { requireType: true });
  }
}

if (mcp && claudeMcp) {
  console.log("\n=== cross-file consistency ===");
  const a = Object.keys(mcp.mcpServers ?? {}).sort();
  const b = Object.keys(claudeMcp.mcpServers ?? {}).sort();
  // Devin merges both sources and .mcp.json wins on a name collision, so if the
  // two lists differ the effective config depends on which layout a client uses.
  check(
    "mcp.json and .mcp.json declare the same server names",
    JSON.stringify(a) === JSON.stringify(b),
    `mcp.json=[${a}] .mcp.json=[${b}]`
  );
}

console.log("\n=== .claude-plugin/marketplace.json (Claude Code) ===");
const market = readJson(".claude-plugin/marketplace.json");
if (market) {
  check("name is present", typeof market.name === "string" && market.name.length > 0);
  check("owner is present with a name", typeof market.owner?.name === "string");
  check("plugins is a non-empty array", Array.isArray(market.plugins) && market.plugins.length > 0);
  for (const [i, entry] of (market.plugins ?? []).entries()) {
    check(`plugins[${i}] has a name`, typeof entry.name === "string");
    check(`plugins[${i}] has a source`, entry.source !== undefined);
    // A relative source containing '..' is rejected by `claude plugin validate`.
    if (typeof entry.source === "string") {
      check(`plugins[${i}] relative source avoids '..'`, !entry.source.includes(".."), entry.source);
    }
    if (plugin && entry.name !== undefined) {
      // The docs warn the entry name and manifest name must match or install-by-name fails.
      const manifestName = claude?.name ?? plugin.name;
      check(`plugins[${i}] name matches the plugin manifest name`, entry.name === manifestName, `${entry.name} vs ${manifestName}`);
    }
  }
}

console.log("\n=== skills/ (Agent Skills) ===");
const skillsDir = path.join(root, "skills");
if (!fs.existsSync(skillsDir)) {
  bad("skills/ exists");
} else {
  const dirs = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  check("at least one skill directory", dirs.length > 0);
  for (const dir of dirs) {
    const skillFile = path.join(skillsDir, dir.name, "SKILL.md");
    if (!fs.existsSync(skillFile)) {
      bad(`skills/${dir.name}/SKILL.md exists`);
      continue;
    }
    const text = fs.readFileSync(skillFile, "utf8");
    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    check(`skills/${dir.name} has frontmatter`, front !== null);
    if (front) {
      const fm = front[1];
      check(`skills/${dir.name} declares a description`, /^description:\s*\S/m.test(fm));
      const nameMatch = /^name:\s*(\S+)/m.exec(fm);
      check(`skills/${dir.name} name matches its directory`, nameMatch ? nameMatch[1] === dir.name : true, nameMatch?.[1]);
    }
  }
}

console.log("\n=== npm tarball stays clean ===");
const pkg = readJson("package.json");
check(
  "plugin files are excluded from the npm package (files whitelist)",
  JSON.stringify(pkg?.files) === JSON.stringify(["dist", "README.md", "LICENSE"]),
  JSON.stringify(pkg?.files)
);

console.log(`\n=== ${checks - failures} passed, ${failures} failed ===\n`);
process.exit(failures === 0 ? 0 : 1);
