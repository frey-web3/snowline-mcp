#!/usr/bin/env node

/**
 * Snowline MCP connector.
 *
 * A thin bridge: your local MCP client speaks STDIO to this process, which
 * forwards everything to Snowline's remote MCP endpoint. No tools live here —
 * the server (`/api/mcp`) defines and executes them, so new Snowline tools
 * (for example `snowline_l1_chains`) appear without a package update.
 */

const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

/**
 * `www` is the canonical host. The bare domain answers with a 308 redirect,
 * and MCP clients (and mcp-remote itself) do not reliably follow redirects, so
 * pointing straight at `www` removes a hop that can fail silently.
 *
 * Override with SNOWLINE_MCP_URL, e.g. a preview deployment or a local server:
 *   SNOWLINE_MCP_URL=http://localhost:3000/api/mcp npx snowline-mcp
 */
const DEFAULT_MCP_URL = "https://www.snowlineapp.xyz/api/mcp";
const MCP_URL = process.env.SNOWLINE_MCP_URL || DEFAULT_MCP_URL;

/**
 * Resolve mcp-remote's entry point rather than spawning the bare command name.
 * npm installs that command as a `.cmd` shim on Windows, and `spawn()` cannot
 * execute a `.cmd` without a shell — which is why the PATH lookup is only the
 * fallback.
 */
function resolveRemoteBin() {
  try {
    const pkgPath = require.resolve("mcp-remote/package.json");
    const pkg = require(pkgPath);
    const relative =
      typeof pkg.bin === "string" ? pkg.bin : pkg.bin && pkg.bin["mcp-remote"];
    if (!relative) return null;

    const absolute = path.join(path.dirname(pkgPath), relative);
    return existsSync(absolute) ? absolute : null;
  } catch {
    return null;
  }
}

const remoteBin = resolveRemoteBin();
const args = [MCP_URL, "--transport", "http-only"];

const server = remoteBin
  ? spawn(process.execPath, [remoteBin, ...args], { stdio: "inherit" })
  : spawn("mcp-remote", args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });

server.on("error", (error) => {
  console.error(
    `Failed to start Snowline MCP (${MCP_URL}): ${error.message}\n` +
      "If mcp-remote is missing, reinstall: npm install -g snowline-mcp"
  );
  process.exit(1);
});

server.on("exit", (code) => {
  process.exit(code ?? 0);
});

process.on("SIGINT", () => server.kill("SIGINT"));
process.on("SIGTERM", () => server.kill("SIGTERM"));
