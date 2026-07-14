#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { MERCHANT_CARD_HTML } from './card.generated.js';

// @curless/agentbank-merchant-mcp — MERCHANT-side stdio MCP for agentbank.
// Lets a merchant read THEIR OWN orders + live Curless wallet balance from an MCP
// client (Claude Desktop), authenticated by their Curless API key passed via env
// — NO OAuth. (The OAuth route is the remote /mcp connector; this is the simple
// token-based path.) Renders the SAME MCP Apps card as the remote /mcp connector
// (built in apps/api/mcp-ui, injected here by emit-card.mjs), with a markdown
// fallback for hosts without the card. Kept separate from the buyer's
// @curless/agentbank-mcp so the two personas don't share a tool surface.
//
// Run (Claude Desktop / any MCP client):
//   npx -y @curless/agentbank-merchant-mcp
// with env:
//   AGENTBANK_API_URL        (default https://mcp.curless.ai; set http://localhost:3000 for local dev)
//   AGENTBANK_MERCHANT_TOKEN your Curless API key (the unified merchant credential)
//   AGENTBANK_MERCHANT_ID    your Curless merchant id, e.g. 429488
//
// IMPORTANT: only JSON-RPC may be written to stdout (the MCP stdio transport).
// Never console.log here — diagnostics go to stderr.

const API_BASE = process.env.AGENTBANK_API_URL ?? 'https://mcp.curless.ai';
const TOKEN = process.env.AGENTBANK_MERCHANT_TOKEN;
const MERCHANT = process.env.AGENTBANK_MERCHANT_ID;

type Order = {
  id: string;
  createdAt?: string;
  amount: number;
  currency: string;
  status?: string;
  lineItems?: unknown;
};
type WalletLine = { currency: string; available: number; frozen: number; channel?: string | null };
type OrdersResponse = { data: Order[]; pagination?: { count?: number; total?: number } };
type SummaryResponse = {
  mode: string;
  count: number;
  byCurrency: Array<{ currency: string; count: number; totalAmount: number }>;
  byProtocol: Array<{ protocol: string; count: number }>;
  byStatus: Array<{ status: string; count: number }>;
};
// Balance = the live Curless wallet (Curless holds the money + reports it). We
// no longer surface our own ledger-derived balance.
type BalanceResponse = { mode: string; curlessWallet: WalletLine[] | null };

type PaymentMethod = {
  type?: string;
  brand?: string | null;
  last4?: string | null;
  funding?: string | null;
  wallet?: string | null;
  provider?: string | null;
  reference?: string | null;
};
type OrderDetail = Order & {
  protocol?: string;
  rail?: string | null;
  paymentMethod?: PaymentMethod | null;
};
type OrderDetailResponse = {
  merchantId: string;
  mode: string;
  order: OrderDetail;
  payment: PaymentMethod | null;
};

// Minor-unit integer → exact decimal string (no currency suffix), per currency.
// Minor-unit decimals per currency. RLUSD is 6-dp like the other stablecoins —
// without it here an RLUSD amount (50000 = 0.05) would format as "500.00".
const DECIMALS: Record<string, number> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0,
  USDC: 6,
  USDT: 6,
  EURC: 6,
  RLUSD: 6,
};
const fmt = (minor: number, currency: string): string => {
  const d = DECIMALS[currency] ?? 2;
  const neg = minor < 0;
  const s = String(Math.abs(minor)).padStart(d + 1, '0');
  const whole = s.slice(0, s.length - d);
  const frac = d > 0 ? `.${s.slice(s.length - d)}` : '';
  return `${neg ? '-' : ''}${whole}${frac}`;
};

// --- Markdown fallback (same shape the remote /mcp connector renders, so both
// merchant surfaces look identical on hosts without the MCP Apps card) ---------
const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const fmtDate = (d?: string): string => (d ? new Date(d).toISOString().slice(0, 10) : '');

const ordersMarkdown = (merchantId: string, orders: Order[]): string => {
  if (orders.length === 0) return `**${merchantId}** — no orders yet.`;
  const rows = orders.map((o) => {
    const li = Array.isArray(o.lineItems)
      ? (o.lineItems as { name?: string; quantity?: number }[])
      : [];
    const items =
      li
        .map((x) => cell(`${x.name ?? ''}${(x.quantity ?? 1) > 1 ? ` ×${x.quantity}` : ''}`))
        .join(', ') || '—';
    return `| \`${o.id}\` | ${fmtDate(o.createdAt)} | ${fmt(o.amount, o.currency)} ${o.currency} | ${o.status ?? ''} | ${items} |`;
  });
  return [
    `**Orders for \`${merchantId}\`** — ${orders.length} shown, newest first`,
    '',
    '| Order | Date | Amount | Status | Items |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
};

const walletMarkdown = (merchantId: string, mode: string, wallet: WalletLine[]): string => {
  if (wallet.length === 0) return `**${merchantId}** (${mode} mode) — no wallet balance yet.`;
  const rows = wallet.map(
    (b) => `| ${b.currency} | **${fmt(b.available, b.currency)}** | ${fmt(b.frozen, b.currency)} |`,
  );
  return [
    `**Curless wallet for \`${merchantId}\`** (${mode} mode) — funds settled into your Curless account`,
    '',
    '| Currency | Available | Frozen |',
    '| --- | --- | --- |',
    ...rows,
  ].join('\n');
};

const orderDetailMarkdown = (r: OrderDetailResponse): string => {
  const o = r.order;
  const pm = r.payment ?? o.paymentMethod ?? null;
  const li = Array.isArray(o.lineItems)
    ? (o.lineItems as { name?: string; quantity?: number; unitPrice?: number }[])
    : [];
  const items = li.length
    ? li
        .map(
          (x) =>
            `- ${cell(x.name ?? '')}${(x.quantity ?? 1) > 1 ? ` ×${x.quantity}` : ''} — ${fmt((x.unitPrice ?? 0) * (x.quantity ?? 1), o.currency)} ${o.currency}`,
        )
        .join('\n')
    : '- (no items)';
  const cardText = pm
    ? [pm.brand, pm.last4 ? `····${pm.last4}` : '', pm.wallet ? `(${pm.wallet})` : '']
        .filter(Boolean)
        .join(' ')
    : '—';
  const source = [o.protocol ? o.protocol.toUpperCase() : '', o.rail ?? pm?.provider]
    .filter(Boolean)
    .join(' · ');
  return [
    `**Order \`${o.id}\`** — ${fmt(o.amount, o.currency)} ${o.currency} · ${o.status ?? ''}`,
    o.createdAt ? fmtDate(o.createdAt) : '',
    '',
    '**Items**',
    items,
    '',
    '**Payment**',
    `- Card: ${cell(cardText)}`,
    source ? `- Source: ${cell(source)}` : '',
    pm?.reference ? `- Reference: \`${cell(String(pm.reference))}\`` : '',
  ]
    .filter(Boolean)
    .join('\n');
};

const api = async <T>(path: string): Promise<T> => {
  if (!TOKEN) throw new Error('set AGENTBANK_MERCHANT_TOKEN (your Curless API key)');
  if (!MERCHANT) throw new Error('set AGENTBANK_MERCHANT_ID (e.g. 429488)');
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) {
    throw new Error(`agentbank ${path} -> ${res.status}: ${await res.text().catch(() => '')}`);
  }
  return (await res.json()) as T;
};

const apiPost = async <T>(path: string, body?: unknown): Promise<T> => {
  if (!TOKEN) throw new Error('set AGENTBANK_MERCHANT_TOKEN (your Curless API key)');
  if (!MERCHANT) throw new Error('set AGENTBANK_MERCHANT_ID (e.g. 429488)');
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`agentbank ${path} -> ${res.status}: ${await res.text().catch(() => '')}`);
  }
  return (await res.json()) as T;
};

const mPath = (suffix: string) => `/v1/merchant/${encodeURIComponent(MERCHANT ?? '')}${suffix}`;

type RefundReq = {
  id: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
  reason?: string | null;
  status: string;
  decisionNote?: string | null;
  createdAt?: string;
};

const refundQueueMarkdown = (rows: RefundReq[]): string => {
  if (!rows.length) return 'No refund requests in range.';
  return rows
    .map(
      (r) =>
        `- \`${cell(r.id)}\` — ${fmt(r.amount, r.currency)} ${cell(r.currency)} · **${r.status}**` +
        ` · order \`${cell(r.paymentIntentId)}\`${r.reason ? ` · ${cell(r.reason)}` : ''}`,
    )
    .join('\n');
};

// Build the optional order-filter query string (status/protocol/currency/date)
// from a tool's args — forwarded verbatim to the gateway, which validates.
const orderQuery = (args: Record<string, unknown>): string => {
  const p = new URLSearchParams();
  for (const k of ['status', 'protocol', 'currency', 'from', 'to']) {
    const v = args[k];
    if (typeof v === 'string' && v) p.set(k, v);
  }
  return p.toString();
};

const summaryMarkdown = (merchantId: string, s: SummaryResponse): string => {
  if (s.count === 0) return `**${cell(merchantId)}** — no orders in range.`;
  const money = s.byCurrency
    .map((c) => `${fmt(c.totalAmount, c.currency)} ${cell(c.currency)} (${c.count})`)
    .join(' · ');
  const proto = s.byProtocol.map((p) => `${cell(p.protocol)}: ${p.count}`).join(' · ');
  const stat = s.byStatus.map((x) => `${x.status}: ${x.count}`).join(' · ');
  return [
    `**${cell(merchantId)}** — ${s.count} orders`,
    `**Gross**: ${money}`,
    `**By protocol**: ${proto}`,
    `**By status**: ${stat}`,
  ].join('\n\n');
};

// MCP Apps card (a ui:// resource). Tools link to it via _meta.ui.resourceUri;
// a UI-capable host (Claude Desktop) renders it as a widget, others fall back to
// the text content. Same card the remote /mcp kit uses (built in apps/api/mcp-ui).
const CARD_URI = 'ui://agentbank-merchant/card-v29.html';
const CARD_MIME = 'text/html;profile=mcp-app';
const UI_META = { ui: { resourceUri: CARD_URI }, 'ui/resourceUri': CARD_URI };

// MCP tool annotations (host hints). Every tool acts only on the merchant's OWN
// agentbank/Curless account — a closed, known system — so openWorldHint is false
// throughout. Reads are read-only; a refund moves money (destructive), while a
// rejection only records a decision (a write, but not destructive).
const READ_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const REFUND_ANNOTATIONS = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };
const STATUS_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
};

const TOOLS = [
  {
    name: 'list_orders',
    description:
      "List this merchant's orders (what agents have paid you), newest first. Filter by status / protocol / currency / date.",
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['paid', 'pending_payment', 'refunded', 'disputed', 'canceled'],
          description: 'order status (refunded/disputed surface Curless actions)',
        },
        protocol: { type: 'string', description: 'acp | x402 | a2a | ucp | …' },
        currency: { type: 'string', description: 'e.g. USDC, EUR, USD' },
        from: { type: 'string', description: 'ISO timestamp lower bound' },
        to: { type: 'string', description: 'ISO timestamp upper bound' },
        limit: { type: 'number', description: 'max rows (default 50, cap 200)' },
        offset: { type: 'number', description: 'rows to skip' },
      },
    },
    _meta: UI_META,
    annotations: READ_ANNOTATIONS,
  },
  {
    name: 'get_summary',
    description:
      "This merchant's order roll-up: count + gross by currency + breakdowns by protocol/status. Same status/protocol/currency/date filters as list_orders.",
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        protocol: { type: 'string' },
        currency: { type: 'string' },
        from: { type: 'string', description: 'ISO timestamp lower bound' },
        to: { type: 'string', description: 'ISO timestamp upper bound' },
      },
    },
    _meta: UI_META,
    annotations: READ_ANNOTATIONS,
  },
  {
    name: 'get_balance',
    description: "This merchant's live Curless wallet balance, per currency.",
    inputSchema: { type: 'object', properties: {} },
    _meta: UI_META,
    annotations: READ_ANNOTATIONS,
  },
  {
    name: 'get_order',
    description:
      "One order's full detail — line items + the card it was paid with. Pass the order id from list_orders.",
    inputSchema: {
      type: 'object',
      properties: { orderId: { type: 'string', description: 'the order id, e.g. ord_…' } },
      required: ['orderId'],
    },
    _meta: UI_META,
    annotations: READ_ANNOTATIONS,
  },
  {
    name: 'list_refund_requests',
    description:
      "Buyers' refund requests on your orders. Default lists status=requested (the queue awaiting your decision); pass status to filter, or status=all for the full history.",
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['all', 'requested', 'approved', 'rejected', 'refunded', 'failed'],
        },
      },
    },
    _meta: UI_META,
    annotations: READ_ANNOTATIONS,
  },
  {
    name: 'approve_refund',
    description:
      'Approve a refund request → forwarded to Curless; the order refunds once Curless confirms. Pass the refund request id (rfr_…).',
    inputSchema: {
      type: 'object',
      properties: { refundRequestId: { type: 'string', description: 'rfr_…' } },
      required: ['refundRequestId'],
    },
    annotations: REFUND_ANNOTATIONS,
  },
  {
    name: 'reject_refund',
    description: 'Reject a refund request (optional note). Pass the refund request id (rfr_…).',
    inputSchema: {
      type: 'object',
      properties: {
        refundRequestId: { type: 'string', description: 'rfr_…' },
        note: { type: 'string' },
      },
      required: ['refundRequestId'],
    },
    annotations: STATUS_WRITE_ANNOTATIONS,
  },
  {
    name: 'refund_order',
    description:
      'Directly refund one of your orders (no buyer request needed). Pass the order id (ord_…); optional partial `amount` + reason. Omit `amount` for a FULL refund. If you DO pass a partial amount, it is in the ORDER’S minor units — read the order first (get_order / list_orders) to see its currency and total, because the units differ by currency.',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: { type: 'string', description: 'ord_… (from list_orders / get_order)' },
        amount: {
          type: 'number',
          description:
            "Partial refund in the ORDER'S minor units — the SAME units as the order's `amount` field shown by get_order/list_orders. The scale depends on the order's currency: 2 decimals for fiat (USD/EUR: 50000 = 500.00) but 6 decimals for stablecoins (USDC/USDT/RLUSD: 50000 = 0.05). So the same number means different money in different currencies — always check the order's currency first. Omit entirely for a full refund; must not exceed the order's remaining refundable amount.",
        },
        reason: { type: 'string', description: 'optional reason, shown in the audit trail' },
      },
      required: ['orderId'],
    },
    annotations: REFUND_ANNOTATIONS,
  },
];

// Tool result that links the card: `structuredContent` feeds the widget, the
// markdown `text` is the universal fallback for hosts without the MCP Apps card.
const card = (markdown: string, structured: Record<string, unknown>) => ({
  content: [{ type: 'text' as const, text: markdown }],
  structuredContent: structured,
  _meta: UI_META,
});

const server = new Server(
  { name: 'agentbank-merchant', version: '0.0.37' },
  { capabilities: { tools: {}, resources: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

// The card resource (MCP Apps): advertise + serve the self-contained HTML.
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [{ uri: CARD_URI, name: 'Merchant card', mimeType: CARD_MIME }],
}));
server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  if (req.params.uri !== CARD_URI) throw new Error(`unknown resource: ${req.params.uri}`);
  return { contents: [{ uri: CARD_URI, mimeType: CARD_MIME, text: MERCHANT_CARD_HTML }] };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  try {
    if (req.params.name === 'list_orders') {
      const limit = Math.min(Number(args.limit) || 50, 200);
      const offset = Math.max(Number(args.offset) || 0, 0);
      const q = orderQuery(args);
      const res = await api<OrdersResponse>(
        mPath(`/orders?limit=${limit}&offset=${offset}${q ? `&${q}` : ''}`),
      );
      return card(ordersMarkdown(MERCHANT ?? '', res.data), {
        merchantId: MERCHANT,
        orders: res.data, // raw (minor amounts) for the card
      });
    }

    if (req.params.name === 'get_summary') {
      const q = orderQuery(args);
      const s = await api<SummaryResponse>(mPath(`/summary${q ? `?${q}` : ''}`));
      // The card renders this as a roll-up (big count + gross by currency +
      // status/protocol chips); markdown is the fallback for card-less hosts.
      return card(summaryMarkdown(MERCHANT ?? '', s), {
        merchantId: MERCHANT,
        mode: s.mode,
        summary: s,
      });
    }

    if (req.params.name === 'get_balance') {
      const b = await api<BalanceResponse>(mPath('/balance'));
      // Show ONLY the Curless wallet (real settled funds), per currency — no
      // agentbank ledger, no channel. structuredContent carries raw minor units
      // for the card; the markdown is the formatted fallback.
      const wallet = b.curlessWallet ?? [];
      return card(walletMarkdown(MERCHANT ?? '', b.mode, wallet), {
        merchantId: MERCHANT,
        mode: b.mode,
        curlessWallet: wallet.map((x) => ({
          currency: x.currency,
          available: x.available,
          frozen: x.frozen,
        })),
      });
    }

    if (req.params.name === 'get_order') {
      const orderId = String(args.orderId ?? '');
      if (!orderId) throw new Error('orderId is required');
      // Forwards to the merchant-kit detail endpoint; the card renders instantly
      // from list_orders data and uses this only to enrich (e.g. the Stripe card).
      const r = await api<OrderDetailResponse>(mPath(`/orders/${encodeURIComponent(orderId)}`));
      return card(orderDetailMarkdown(r), {
        merchantId: MERCHANT,
        mode: r.mode,
        order: r.order,
        payment: r.payment,
      });
    }

    if (req.params.name === 'list_refund_requests') {
      const raw = typeof args.status === 'string' && args.status ? args.status : 'requested';
      // 'all' → omit the status query (the whole history); else filter by status.
      const qs = raw === 'all' ? '' : `?status=${encodeURIComponent(raw)}`;
      const res = await api<{ mode?: string; refundRequests: RefundReq[] }>(
        mPath(`/refund-requests${qs}`),
      );
      // The card renders the queue (Approve / Reject on a pending row); markdown is
      // the fallback for card-less hosts. `status` echoes the applied filter ('all'
      // included) so the card highlights the matching chip.
      return card(refundQueueMarkdown(res.refundRequests), {
        merchantId: MERCHANT,
        mode: res.mode,
        status: raw,
        refundRequests: res.refundRequests,
      });
    }

    if (req.params.name === 'approve_refund') {
      const rid = String(args.refundRequestId ?? '');
      if (!rid) throw new Error('refundRequestId is required');
      const { refundRequest: r } = await apiPost<{ refundRequest: RefundReq }>(
        mPath(`/refund-requests/${encodeURIComponent(rid)}/approve`),
      );
      return {
        content: [
          {
            type: 'text',
            text: `Approved refund \`${cell(r.id)}\` — ${fmt(r.amount, r.currency)} ${cell(r.currency)} forwarded to Curless; the order refunds once Curless confirms.`,
          },
        ],
      };
    }

    if (req.params.name === 'reject_refund') {
      const rid = String(args.refundRequestId ?? '');
      if (!rid) throw new Error('refundRequestId is required');
      const note = typeof args.note === 'string' ? args.note : undefined;
      const { refundRequest: r } = await apiPost<{ refundRequest: RefundReq }>(
        mPath(`/refund-requests/${encodeURIComponent(rid)}/reject`),
        { note },
      );
      return { content: [{ type: 'text', text: `Rejected refund \`${cell(r.id)}\`.` }] };
    }

    if (req.params.name === 'refund_order') {
      const orderId = String(args.orderId ?? '');
      if (!orderId) throw new Error('orderId is required');
      const { refundRequest: r } = await apiPost<{ refundRequest: RefundReq }>(
        mPath(`/orders/${encodeURIComponent(orderId)}/refund`),
        {
          amount: typeof args.amount === 'number' ? args.amount : undefined,
          reason: typeof args.reason === 'string' ? args.reason : undefined,
        },
      );
      return {
        content: [
          {
            type: 'text',
            text: `Refund opened for order \`${cell(orderId)}\` — ${fmt(r.amount, r.currency)} ${cell(r.currency)} forwarded to Curless.`,
          },
        ],
      };
    }

    return { content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }], isError: true };
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${(err as Error).message}` }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
