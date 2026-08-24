# @curless/agentbank-merchant-mcp

Merchant-side MCP server for [agentbank](https://github.com/agentbankmcp/agentbank-merchant-mcp).
Lets a merchant read **their own orders and live Curless wallet balance** (real
funds settled into the merchant's Curless account) from an MCP client (Claude
Desktop).

Authenticated by your **Curless API key via env — no OAuth.** (The OAuth route is
the remote `/mcp` connector added by URL in claude.ai; this is the simple
token-based path for Claude Desktop / stdio clients.) Kept separate from the
buyer's `@curless/agentbank-mcp` so the two personas don't share a tool surface.
Renders the **same MCP Apps card** as the remote `/mcp` connector, with a markdown
table fallback for hosts without the card.

## Tools

Orders:
- **`list_orders`** — this merchant's orders (what agents have paid), newest first; filter by status / protocol / currency / date.
- **`get_summary`** — order roll-up: count + gross by currency + breakdowns by protocol/status.
- **`get_balance`** — the live Curless wallet balance per currency (available / frozen).
- **`get_order`** — one order in full: line items + the card it was paid with.

Refunds:
- **`list_refund_requests`** — buyers' refund requests on your orders (the queue; filter by status).
- **`approve_refund`** — approve a request → forwarded to Curless (the order refunds once Curless confirms).
- **`reject_refund`** — decline a request (optional note).
- **`refund_order`** — refund one of your orders directly (no buyer request needed).

All eight render into the same MCP Apps card (orders list / detail / summary / wallet / refund queue) with a markdown fallback for hosts without the card.

## Use (Claude Desktop `claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "agentbank-merchant": {
      "command": "/usr/local/bin/npx",
      "args": ["-y", "@curless/agentbank-merchant-mcp"],
      "env": {
        "AGENTBANK_MERCHANT_TOKEN": "<your-curless-api-key>",
        "AGENTBANK_MERCHANT_ID": "429488"
      }
    }
  }
}
```

| env | what |
| --- | --- |
| `AGENTBANK_MERCHANT_TOKEN` | your Curless API key (issued by Curless at onboarding) |
| `AGENTBANK_MERCHANT_ID` | your Curless merchant id, e.g. `429488` |

The server talks to `https://mcp.curless.ai` by default — no need to configure it.
(Local dev only: set `AGENTBANK_API_URL=http://localhost:3000` to point at a local API.)
