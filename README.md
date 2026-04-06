# Mural Pay Marketplace Backend

A backend service for a marketplace that accepts **USDC payments on Polygon** and automatically converts them to **Colombian Pesos (COP)** via the [Mural Pay API](https://developers.muralpay.com). Built as a take-home challenge demonstrating end-to-end crypto-to-fiat payment processing.

## How It Works

```
Customer  --> POST /orders --> receives merchant wallet address + exact USDC amount
          --> sends USDC on Polygon (external wallet transaction)

Mural     --> webhook --> server detects deposit --> matches to pending order
          --> auto-creates + executes USDC -> COP payout to merchant's bank

Merchant  --> GET /merchant/orders       -- view all orders & payment status
          --> GET /merchant/withdrawals  -- view COP withdrawal status
```

**Order lifecycle:** `PENDING_PAYMENT` -> `PAID` -> `PAYOUT_PENDING` -> `PAYOUT_COMPLETE`

---

## Tech Stack

| Component   | Choice                  | Rationale                                     |
| ----------- | ----------------------- | --------------------------------------------- |
| Runtime     | Node.js 20 / TypeScript | Fast iteration, strong typing                 |
| Framework   | Express 5               | Lightweight, widely understood                |
| Database    | PostgreSQL              | Relational, production-grade, supports enums  |
| DB Client   | `pg` (raw SQL queries)  | No ORM overhead, full control over queries    |
| HTTP Client | Axios                   | Clean interface for Mural API calls           |
| Scheduler   | node-cron               | In-process backup polling for missed webhooks |
| Deployment  | Railway                 | Easy deploy, public URL, PostgreSQL plugin    |

---

## Project Structure

```
src/
  index.ts              # Entry point: init DB, start server, start cron
  app.ts                # Express app setup, middleware, route mounting
  config.ts             # Environment variable loading and validation
  db.ts                 # PostgreSQL connection pool (pg)
  initDb.ts             # Schema initialization (CREATE TABLE IF NOT EXISTS)
  types.ts              # Shared TypeScript interfaces
  routes/
    products.ts         # GET /products, GET /products/:id
    orders.ts           # POST /orders, GET /orders/:id
    merchant.ts         # Auth-gated merchant dashboard endpoints
    admin.ts            # POST /admin/setup, POST /admin/products, GET /admin/config
    webhooks.ts         # POST /webhooks/mural (Mural event receiver)
  services/
    mural.ts            # Mural API client (accounts, payouts, webhooks, etc.)
    orderService.ts     # Deposit matching: links incoming USDC to pending orders
    payoutService.ts    # Payout lifecycle: create, execute, sync status
  jobs/
    pollTransactions.ts # Cron job: polls Mural transactions every 60s as webhook backup
  middleware/
    auth.ts             # x-api-key header validation for merchant/admin routes
  utils/
    formatters.ts       # Response formatting helpers
scripts/
  setup.ts              # One-time setup: create Mural resources + seed products
  test-api.sh           # API smoke test suite (curl-based, no dependencies)
```

---

## Setup Instructions

### Prerequisites

- **Node.js 20+**
- **PostgreSQL** database (local or hosted)
- **Mural Pay Sandbox** account with:
  - API Key
  - Transfer API Key

### 1. Clone and Install

```bash
git clone <repo-url>
cd MuralPayChallenge
npm install
```

### 2. Configure Environment

Create a `.env` file in the project root:

```env
DATABASE_URL="postgresql://user:pass@localhost:5432/muralpay"
MURAL_API_KEY="your-mural-api-key"
MURAL_TRANSFER_API_KEY="your-mural-transfer-api-key"
MURAL_BASE_URL="https://api-staging.muralpay.com"
PORT=3000
MERCHANT_API_SECRET="your-secret-key"
WEBHOOK_PUBLIC_URL="https://your-deployed-url.railway.app"
```

| Variable                 | Required | Description                                              |
| ------------------------ | -------- | -------------------------------------------------------- |
| `DATABASE_URL`           | Yes      | PostgreSQL connection string                             |
| `MURAL_API_KEY`          | Yes      | Mural sandbox API key                                    |
| `MURAL_TRANSFER_API_KEY` | Yes      | Mural transfer API key (for account creation & payouts)  |
| `MURAL_BASE_URL`         | No       | Defaults to `https://api-staging.muralpay.com`           |
| `PORT`                   | No       | Defaults to `3000`                                       |
| `MERCHANT_API_SECRET`    | Yes      | Shared secret for merchant/admin endpoint authentication |
| `WEBHOOK_PUBLIC_URL`     | No       | Public URL for webhook registration (set after deploy)   |

### 3. Start the Server

```bash
# Development (with hot reload via nodemon)
npm run dev

# Production
npm run build
npm start
```

The database schema is **auto-initialized on startup** via `src/initDb.ts` -- no separate migration step needed.

### 4. Run Setup (one-time)

The setup creates all necessary Mural resources and seeds sample products:

```bash
npm run setup
```

This is idempotent and will:

1. Create (or reuse) a Mural account with a Polygon USDC wallet
2. Create (or find) a counterparty representing the merchant
3. Create (or find) a COP payout method with Colombian bank details
4. Register and activate a webhook (if `WEBHOOK_PUBLIC_URL` is set)
5. Seed 5 sample products (if none exist)

Alternatively, use `POST /admin/setup` with the `x-api-key` header after the server is running.

---

## Deployment (Railway)

1. Push the repo to GitHub
2. Create a new Railway project and deploy from GitHub
3. Add the **PostgreSQL** plugin -- copy `DATABASE_URL` to environment variables
4. Set all environment variables from `.env`
5. Railway will auto-detect the `Dockerfile` or use the start command from `railway.json`
6. After deploy, note the public URL and set `WEBHOOK_PUBLIC_URL`
7. Run setup via the API: `curl -X POST https://your-app.railway.app/admin/setup -H "x-api-key: your-secret"`

The included `Dockerfile` and `railway.json` handle the build automatically.

---

## API Reference

Full OpenAPI spec: [`openapi.json`](./openapi.json)

### Public Endpoints

| Method | Path            | Description                                    |
| ------ | --------------- | ---------------------------------------------- |
| GET    | `/health`       | Health check                                   |
| GET    | `/products`     | List all active products                       |
| GET    | `/products/:id` | Get a single product by ID                     |
| POST   | `/orders`       | Create an order (returns wallet + USDC amount) |
| GET    | `/orders/:id`   | Get order status, items, and withdrawal info   |

### Merchant Endpoints (requires `x-api-key` header)

| Method | Path                        | Description                            |
| ------ | --------------------------- | -------------------------------------- |
| GET    | `/merchant/orders`          | List all orders (paginated)            |
| GET    | `/merchant/orders/:id`      | Order detail with items and withdrawal |
| GET    | `/merchant/withdrawals`     | List all COP withdrawals (paginated)   |
| GET    | `/merchant/withdrawals/:id` | Withdrawal detail with exchange rate   |

### Admin Endpoints (requires `x-api-key` header)

| Method | Path              | Description                             |
| ------ | ----------------- | --------------------------------------- |
| POST   | `/admin/setup`    | Initialize Mural resources (idempotent) |
| GET    | `/admin/config`   | View current merchant configuration     |
| POST   | `/admin/products` | Create a new product                    |

### Webhook

| Method | Path              | Description                                |
| ------ | ----------------- | ------------------------------------------ |
| POST   | `/webhooks/mural` | Receives Mural events (not for direct use) |

---

## Current Status

- **Database**: PostgreSQL schema is deployed and auto-initializes on server startup (tables, enums, constraints).
- **API**: All endpoints are deployed on Railway and operational. The `scripts/test-api.sh` smoke test suite verifies health, admin setup, product CRUD, order creation/validation, and merchant dashboard endpoints end-to-end against the live deployment.
- **Mural integration**: Account, counterparty, COP payout method, and webhook are all registered in the Mural sandbox. The webhook endpoint accepts events and returns 200.
- **Payment detection**: Not yet verified end-to-end. Deposits sent via the Mural sandbox have not been matched to pending orders -- the Mural transaction search API returns zero results for the account, so the matching logic has nothing to work with. This needs further investigation into how sandbox deposits surface in the Mural API.

---

## Future Work

1. **Fix payment detection** -- The webhook and polling infrastructure is in place, but deposits are not appearing in Mural's transaction search API. This may require using a different sandbox flow to simulate inbound USDC deposits, or a different Mural API endpoint to query them.

2. **Replace FIFO amount matching** -- The current strategy matches deposits to orders by exact USDC amount (oldest pending order first). This will not scale: multiple orders with the same total are ambiguous, and concurrent payments of the same amount will be matched arbitrarily. A more robust approach would embed a unique sub-cent amount per order (e.g., `$50.003287`) or use Mural's Payin API to generate unique deposit addresses per order.

3. **Order expiry cron** -- Periodically mark stale `PENDING_PAYMENT` orders as `EXPIRED`.

4. **Idempotency keys** -- Pass UUID keys to Mural payout creation for safe retries.

5. **JWT authentication** -- Replace the shared `x-api-key` with proper customer/merchant auth.

6. **Webhook event log** -- Persist and deduplicate webhook events across restarts.

7. **Rate limiting** -- Protect public endpoints from abuse.

8. **Stock management** -- Decrement on order creation, restore on expiry/failure.
