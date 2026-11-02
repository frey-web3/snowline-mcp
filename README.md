# snowline-mcp

Connect AI agents (Claude Desktop, Cursor, and other MCP clients) to the Snowline Avalanche ecosystem intelligence API.

Snowline MCP is already hosted at `https://www.snowlineapp.xyz/api/mcp`. This package is a lightweight connector that bridges your local MCP client's STDIO transport to Snowline's remote Streamable HTTP MCP endpoint.

## Install

```bash
npm install -g snowline-mcp
```

Or run directly with npx:

```bash
npx -y snowline-mcp
```

## Usage

### Claude Desktop

Add to your `claude_desktop_config.json`:

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

### Cursor / Other STDIO MCP Clients

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

### Pointing somewhere else

The connector talks to `https://www.snowlineapp.xyz/api/mcp` by default. Set
`SNOWLINE_MCP_URL` to use a preview deployment or a local server:

```json
{
  "mcpServers": {
    "snowline": {
      "command": "npx",
      "args": ["-y", "snowline-mcp"],
      "env": { "SNOWLINE_MCP_URL": "http://localhost:3000/api/mcp" }
    }
  }
}
```

## Architecture

```text
Claude / Cursor / Other MCP Client
              |
              | STDIO
              v
       npx snowline-mcp
              |
              | Streamable HTTP
              v
https://www.snowlineapp.xyz/api/mcp
              |
              v
       Snowline MCP Server
              |
              v
        Snowline Database
```

| Component | Purpose |
|---|---|
| Snowline `/api/mcp` | Actual MCP server and tools |
| npm `snowline-mcp` | Installation and connection bridge |
| Vercel | Hosts the MCP endpoint |
| npm registry | Distributes the connector |

## Available Data

Through the remote Snowline MCP endpoint you can access:

- **Avalanche L1 chains** — the mainnet L1 directory with live per-chain telemetry: latest block and time, 24h and all-time transactions, average/peak TPS, active addresses, fees paid, VM, EVM chain ID, blockchain ID, subnet ID, RPC and explorer URL (`snowline_l1_chains`)
- **Blockchain data** — AVAX supply, blocks, transactions, balances (native/ERC-20/NFT), contracts, chains, validators, subnets, rewards, metrics
- **Token data** — Search, trending tokens, token metadata by address (live DexScreener data)
- **Businesses** — Avalanche ecosystem projects, summaries, articles
- **Users** — Ecosystem user profiles, top builders
- **Wallet intelligence** — Whale/smart-money profiles, top whales
- **News** — Latest press releases
- **User data** — Tracked businesses, saved tokens/users/addresses

See the Snowline docs for the full function reference and natural-language query examples.

## Maintenance

All actual MCP logic stays on Snowline/Vercel. This npm package only handles the connection, so:

- Updating Snowline's MCP tools does not require republishing npm.
- Updating business data does not require users to reinstall.
- Only publish a new npm version when the connector itself changes.

### Publishing a new version

```bash
cd D:\snowline-mcp
npm login                    # once per machine
npm version patch            # or: minor / major
npm publish                  # unscoped package => public
npm view snowline-mcp version  # verify what the registry has
```

Users get it on the next `npx -y snowline-mcp` run; a globally installed copy
needs `npm install -g snowline-mcp@latest`.

## License

MIT
