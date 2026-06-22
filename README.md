# @curless/agentbank-merchant-mcp

Merchant-side MCP server for **agentbank** (the "Stripe for AI agents"). Lets a
merchant read **their own orders and live Curless wallet balance** (real funds
settled into the merchant's Curless account) from an MCP client such as Claude
Desktop.

Authenticated by your **Curless API key via env — no OAuth.** Renders an **MCP
Apps card** (orders / balance widget) in hosts that support it, with a markdown
table fallback everywhere else. Kept separate from the buyer-side MCP so the two
personas don't share a tool surface.

> Published to npm as [`@curless/agentbank-merchant-mcp`](https://www.npmjs.com/package/@curless/agentbank-merchant-mcp).

## Tools

- **`list_orders`** — this merchant's orders (what agents have paid), newest first.
- **`get_balance`** — the live Curless wallet balance per currency (available / frozen).
- **`get_order`** — one order in full: line items + the card it was paid with.

## Install (Claude Desktop)

**Desktop extension (.mcpb):** install `agentbank-merchant.mcpb` and enter your
Curless API key + merchant id when prompted.

**Or via `claude_desktop_config.json`:**

```json
{
  "mcpServers": {
    "agentbank-merchant": {
      "command": "/usr/local/bin/npx",
      "args": ["-y", "@curless/agentbank-merchant-mcp"],
      "env": {
        "AGENTBANK_MERCHANT_TOKEN": "<your-curless-api-key>",
        "AGENTBANK_MERCHANT_ID": "888888"
      }
    }
  }
}
```

| env | what |
| --- | --- |
| `AGENTBANK_MERCHANT_TOKEN` | your Curless API key (issued by Curless at onboarding) |
| `AGENTBANK_MERCHANT_ID` | your Curless merchant id, e.g. `888888` |

The server talks to `https://mcp.curless.ai` by default — no need to configure it.
(Local dev only: set `AGENTBANK_API_URL=http://localhost:3000` to point at a local API.)

## Build the desktop extension (.mcpb)

```bash
npm install
npm run build:mcpb     # esbuild → self-contained server bundle, then `mcpb pack`
```

This writes `mcpb/server/index.js` (a single self-contained ESM bundle) and packs
`agentbank-merchant.mcpb`. Both are git-ignored build artifacts.

## License

MIT © robin
