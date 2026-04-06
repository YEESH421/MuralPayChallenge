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

## Testing

### Smoke Test Suite

An automated smoke test script exercises all endpoints:

```bash
# Against local server (default)
./scripts/test-api.sh

# Against a deployed instance
./scripts/test-api.sh https://your-app.railway.app

# With a custom API key
./scripts/test-api.sh https://your-app.railway.app your-secret-key
```

The script requires only `curl` and `python3`. It creates its own test fixtures and validates response status codes and body content. Exit code 0 means all tests passed.

### Manual End-to-End Flow

**1. Create an order:**

```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customer": { "name": "Jane Doe", "email": "jane@example.com" },
    "items": [{ "productId": "<product-id>", "quantity": 1 }]
  }'
```

The response includes `walletAddress`, `totalUsdc`, `blockchain: "POLYGON"`, and human-readable `instructions`.

**2. Send payment:**

Send the exact USDC amount to the wallet address on Polygon. In sandbox, use the Mural dashboard: **Move Money -> Pay -> +Add Contact** with the wallet address.

**3. Check order status:**

```bash
curl http://localhost:3000/orders/<order-id>
```

Status progresses: `PENDING_PAYMENT` -> `PAID` -> `PAYOUT_PENDING` -> `PAYOUT_COMPLETE`

**4. View merchant dashboard:**

```bash
curl http://localhost:3000/merchant/orders -H "x-api-key: your-secret"
curl http://localhost:3000/merchant/withdrawals -H "x-api-key: your-secret"
```

---

## Database Schema

The schema is auto-created on server startup. All tables use UUID primary keys.

| Table            | Purpose                                                    |
| ---------------- | ---------------------------------------------------------- |
| `Product`        | Catalog items (name, price in USDC, stock, active flag)    |
| `Customer`       | Buyer identity (name, email)                               |
| `Order`          | Purchase record linking customer to payment state          |
| `OrderItem`      | Line items within an order (product, quantity, unit price) |
| `Withdrawal`     | Tracks USDC->COP payout requests and their Mural status    |
| `MerchantConfig` | Singleton: Mural account ID, wallet, counterparty, webhook |

**Custom enums:**

- `OrderStatus`: `PENDING_PAYMENT`, `PAID`, `PAYOUT_PENDING`, `PAYOUT_COMPLETE`, `PAYOUT_FAILED`, `EXPIRED`
- `WithdrawalStatus`: `INITIATED`, `AWAITING_EXECUTION`, `PENDING`, `COMPLETED`, `FAILED`, `REFUND_IN_PROGRESS`, `REFUNDED`

---

## Payment Matching

Incoming USDC deposits are matched to pending orders by **exact amount (FIFO)**. When a deposit webhook arrives (or the 60-second polling job runs), the system:

1. Fetches recent transactions from the Mural API
2. Filters for deposits not yet matched to an order
3. For each deposit, finds the oldest `PENDING_PAYMENT` order with a matching `totalUsdc`
4. Marks the order as `PAID` and immediately initiates a COP payout
