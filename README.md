# Mural Pay Marketplace Backend

A backend service powering a marketplace that accepts USDC payments on Polygon and automatically converts receipts to Colombian Pesos (COP) via the [Mural Pay API](https://developers.muralpay.com).

## Architecture

```
Customer → POST /orders → gets merchant wallet address + USDC amount
         → sends USDC on Polygon (externally)

Mural → webhook → our server detects deposit → matches to order
      → auto-creates + executes USDC→COP payout to merchant bank

Merchant → GET /merchant/orders   — view payment status
         → GET /merchant/withdrawals — view COP withdrawal status
```

## Tech Stack

- **Node.js / TypeScript** + Express
- **PostgreSQL** (raw `pg` queries)
- **Mural Pay Sandbox API** for USDC custody and COP payouts
- **node-cron** for backup transaction polling
- Deployed on **Railway**

---

## Setup Instructions

### Prerequisites
- Node.js 20+
- PostgreSQL database (or Railway PostgreSQL plugin)
- Mural Pay Sandbox account with API Key + Transfer API Key

### 1. Clone & Install

```bash
git clone <repo-url>
cd MuralPayChallenge
npm install
```

### 2. Configure Environment

Copy `.env` and fill in your values:

```bash
DATABASE_URL="postgresql://user:pass@host:5432/muralpay"
MURAL_API_KEY="your-api-key"
MURAL_TRANSFER_API_KEY="your-transfer-api-key"
MURAL_BASE_URL="https://api-staging.muralpay.com"
PORT=3000
MERCHANT_API_SECRET="your-secret"
WEBHOOK_PUBLIC_URL="https://your-deployed-url.railway.app"
```

### 3. Run Database Migration

The schema is initialized automatically on server startup via `src/initDb.ts`.

### 4. Run Setup Script (one-time)

Creates the Mural account, counterparty, COP payout method, and webhook:

```bash
npm run setup
```

### 5. Start Dev Server

```bash
npm run dev
```

---

## Deployment (Railway)

1. Push repo to GitHub (public)
2. Create new Railway project → Deploy from GitHub
3. Add **PostgreSQL** plugin → copy `DATABASE_URL` to env vars
4. Set all env vars from `.env`
5. Set start command: `npm run build && node dist/index.js`
6. After deploy, open Railway shell and run: `npm run setup`
7. Note the public URL → set `WEBHOOK_PUBLIC_URL` → re-run `npm run setup` to register webhook

---

## API Reference

Full OpenAPI spec: [`openapi.json`](./openapi.json)

### Customer Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | Health check |
| GET | `/products` | None | List products |
| GET | `/products/:id` | None | Get product |
| POST | `/orders` | None | Create order |
| GET | `/orders/:id` | None | Get order + payment status |

### Merchant Endpoints (`x-api-key` header required)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/merchant/orders` | All orders with payment status |
| GET | `/merchant/orders/:id` | Order detail + withdrawal |
| GET | `/merchant/withdrawals` | All COP withdrawals |
| GET | `/merchant/withdrawals/:id` | Withdrawal detail |

### Admin Endpoints (`x-api-key` header required)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/admin/setup` | Initialize Mural resources |
| GET | `/admin/config` | View merchant config |
| POST | `/admin/products` | Create a product |

### Webhook

`POST /webhooks/mural` — receives Mural events (not for direct use)

---

## Testing the Flow

### 1. Create an Order

```bash
curl -X POST https://your-app.railway.app/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customer": { "name": "Jane Doe", "email": "jane@example.com" },
    "items": [{ "productId": "<product-id>", "quantity": 1 }]
  }'
```

Response includes `walletAddress` and `totalUsdc` — the customer sends exactly that amount of USDC to that Polygon address.

### 2. Simulate Payment

In the Mural dashboard: **Move Money → Pay → +Add Contact** → enter the merchant wallet address → send the exact USDC amount.

### 3. Check Order Status

```bash
curl https://your-app.railway.app/orders/<order-id>
```

Status will progress: `PENDING_PAYMENT → PAID → PAYOUT_PENDING → PAYOUT_COMPLETE`

### 4. Check Merchant Dashboard

```bash
# View orders
curl https://your-app.railway.app/merchant/orders \
  -H "x-api-key: merchant-secret-key"

# View COP withdrawals
curl https://your-app.railway.app/merchant/withdrawals \
  -H "x-api-key: merchant-secret-key"
```

---

## Current Status

- ✅ Product catalog (CRUD)
- ✅ Order creation with USDC payment instructions
- ✅ Mural webhook handler for deposit detection
- ✅ Deposit-to-order matching (exact USDC amount)
- ✅ Automatic USDC → COP payout on payment receipt
- ✅ Payout status tracking via webhook + polling
- ✅ Merchant dashboard (orders + withdrawals)
- ✅ Backup polling job (60s interval)
- ✅ OpenAPI specification
- ⚠️ Webhook signature verification implemented but needs testing with a live Mural webhook

---

## Payment Matching Pitfalls

The challenge explicitly notes that a "fully-bulletproof matching system for incoming deposits" is difficult. Our approach: **match by exact USDC amount, FIFO**.

**Known pitfalls:**

1. **Duplicate amounts** — Two pending orders with the same USDC total are matched FIFO (oldest first). If the wrong customer paid, a manual refund is required.

2. **Partial payments** — A customer sends the wrong amount. It won't match any order and sits as an unmatched deposit. Logged for manual review.

3. **Late payments** — Payment arrives after order expiry. Not matched. Logged for manual review.

4. **Missed webhooks** — Covered by 60-second backup polling. If the server was down during a payment window, the next poll will catch it.

5. **Multiple deposits in quick succession** — Each is processed sequentially; the unique constraint on `muralTransactionId` prevents double-matching.

**Mitigation options for production:**
- Use unique payment references (add a small random amount to each order's USDC price, e.g. $10.003287)
- Use Mural's Payin API to generate unique deposit addresses per order (not available in sandbox for USDC on Polygon)

---

## Future Work

1. **Unique payment amounts** — Embed a unique sub-cent amount per order (e.g. `$10.003287`) to make matching deterministic.

2. **Order expiry cron** — Periodic job to mark stale `PENDING_PAYMENT` orders as `EXPIRED`.

3. **Idempotency keys** — Pass UUID idempotency keys to Mural payout creation for safe retries.

4. **Proper auth** — JWT-based customer auth instead of open endpoints; role-based access for merchant.

5. **Webhook retry handling** — Persist webhook event log to prevent duplicate processing across restarts.

6. **Rate limiting** — Protect public endpoints from abuse.

7. **Monitoring** — Integrate error tracking (Sentry) and structured logging (Pino/Winston).

8. **Admin UI** — Simple dashboard for the merchant to manage products and view orders.

9. **Stock management** — Decrement stock on order creation, restore on expiry/failure.

10. **Multi-currency** — Accept EUR or other stablecoins, not just USDC on Polygon.
