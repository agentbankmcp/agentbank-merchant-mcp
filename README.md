# @curless/agentbank-merchant-mcp

Merchant-side MCP server for **agentbank** (the "Stripe for AI agents"). Lets a
merchant read **their own orders and live Curless wallet balance** (real funds
settled into the merchant's Curless account) — and handle refunds — from an MCP
client such as Claude Desktop.

Authenticated by your **Curless API key via env — no OAuth.** (The OAuth route is
the remote `/mcp` connector added by URL in claude.ai; this is the simple
token-based path for Claude Desktop / stdio clients.) Renders an **MCP Apps card**
(orders / detail / summary / wallet / refund queue) in hosts that support it, with
a markdown table fallback everywhere else. Kept separate from the buyer-side MCP so
the two personas don't share a tool surface.

> Published to npm as [`@curless/agentbank-merchant-mcp`](https://www.npmjs.com/package/@curless/agentbank-merchant-mcp).

## Tools

Orders:

- **`list_orders`** — this merchant's orders (what agents have paid), newest first; filter by status / protocol / currency / date.
- **`get_summary`** — order roll-up: count + gross by currency + breakdowns by protocol / status.
- **`get_balance`** — the live Curless wallet balance per currency (available / frozen).
- **`get_order`** — one order in full: line items + the card it was paid with.

Refunds:

- **`list_refund_requests`** — buyers' refund requests on your orders (the queue; filter by status).
- **`approve_refund`** — approve a request → forwarded to Curless (the order refunds once Curless confirms).
- **`reject_refund`** — decline a request (optional note).
- **`refund_order`** — refund one of your orders directly (no buyer request needed).

All eight render into the same MCP Apps card (orders list / detail / summary /
wallet / refund queue) with a markdown fallback for hosts without the card.

## Security & permissions

- **Auth** — a single Curless API key (`AGENTBANK_MERCHANT_TOKEN`) via env: **no
  OAuth, no browser flow**. The key stays on your machine and is sent only to
  `https://mcp.curless.ai` over TLS to call agentbank on your behalf.
- **Scope** — the key is **merchant-scoped**: it can only ever read and act on
  **your own** merchant's data (your orders, your Curless wallet, your refund
  queue). It can never see another merchant.
- **Reads** — `list_orders` / `get_summary` / `get_order` (your order history +
  line items) and `get_balance` (your live Curless wallet balance).
- **Writes that move money** — `approve_refund` and `refund_order` **issue refunds
  to buyers** (funds leave your Curless balance); `reject_refund` only records a
  decision. These are the only state-changing tools — everything else is read-only.
- **No local system access** — the server only makes outbound HTTPS calls to
  agentbank. It does not read your filesystem, run shell commands, or touch
  anything outside its own process.

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
