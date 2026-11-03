#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SnowlineClient } from "./client.js";
import { SnowlineConfigError, loadConfig } from "./config.js";
import { EndpointRegistry } from "./openapi.js";
import { SERVER_NAME, SERVER_VERSION, createServer } from "./server.js";

/**
 * Entry point.
 *
 * stdout is the MCP JSON-RPC channel and must never carry anything else, so
 * every diagnostic in this file goes to stderr.
 */

const HELP = `${SERVER_NAME} ${SERVER_VERSION} — Snowline Avalanche ecosystem intelligence over MCP.

Usage:
  npx -y ${SERVER_NAME}          Start the MCP server on stdio (normal use).

This command speaks the Model Context Protocol on stdio. It is launched by an
MCP client, not by hand. Configure your client, for example Cursor's
.cursor/mcp.json:

  {
    "mcpServers": {
      "snowline": { "command": "npx", "args": ["-y", "${SERVER_NAME}"] }
    }
  }

Environment:
  SNOWLINE_API_URL             API base (default https://www.snowlineapp.xyz/api)
  SNOWLINE_API_KEY             Optional bearer token; public endpoints need none
  SNOWLINE_TIMEOUT_MS          Per-request timeout (default 20000)
  SNOWLINE_MAX_RESPONSE_BYTES  Response size cap (default 2000000)
  SNOWLINE_DEFAULT_LIMIT       Records per call when unspecified (default 20)
  SNOWLINE_MAX_LIMIT           Upper bound a tool may request (default 100)
  SNOWLINE_OPENAPI_TTL_MS      How long the endpoint catalog is cached (default 600000)

Tools are prefixed "snowline_local_" so this server can run alongside the remote
Snowline MCP server without tool-name collisions. snowline_local_api can call any
endpoint Snowline documents under /v1, including ones added after this release.

Docs: https://www.snowlineapp.xyz/mcp
`;

function main(): void {
  const arg = process.argv[2];
  if (arg === "--help" || arg === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (arg === "--version" || arg === "-v") {
    process.stdout.write(`${SERVER_VERSION}\n`);
    return;
  }

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    const message =
      error instanceof SnowlineConfigError ? error.message : String(error);
    process.stderr.write(`${SERVER_NAME}: invalid configuration — ${message}\n`);
    process.exit(1);
  }

  const client = new SnowlineClient(config);
  const registry = new EndpointRegistry(client, config.openapiTtlMs);
  const server = createServer(client, registry);
  const transport = new StdioServerTransport();

  server
    .connect(transport)
    .then(() => {
      // stderr only: stdout belongs to the protocol.
      process.stderr.write(
        `${SERVER_NAME} ${SERVER_VERSION} ready — API ${config.apiUrl}, limit ${config.defaultLimit}/${config.maxLimit}.\n`
      );
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `${SERVER_NAME}: failed to start — ${error instanceof Error ? error.message : String(error)}\n`
      );
      process.exit(1);
    });

  const shutdown = (): void => {
    void server.close().finally(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
