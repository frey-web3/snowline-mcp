#!/usr/bin/env node

const { spawn } = require("child_process");

const MCP_URL = "https://snowlineapp.xyz/api/mcp";

const server = spawn(
  "mcp-remote",
  [
    MCP_URL,
    "--transport",
    "http-only"
  ],
  {
    stdio: "inherit"
  }
);

server.on("error", (error) => {
  console.error("Failed to start Snowline MCP:", error);
  process.exit(1);
});

server.on("exit", (code) => {
  process.exit(code ?? 0);
});

process.on("SIGINT", () => server.kill("SIGINT"));
process.on("SIGTERM", () => server.kill("SIGTERM"));