# Mural Pay Marketplace Backend - High-Level Plan

## Main Entities

### Local Entities (our database)

| Entity | Purpose |
|--------|---------|
| **Product** | Items in the merchant's catalog (name, description, price in USDC, image, stock) |
| **Order** | A customer's purchase. Links cart items to a payment. Tracks lifecycle from `PENDING_PAYMENT` through `PAID` to `PAYOUT_COMPLETE` |
| **OrderItem** | Line items within an order (product, quantity, unit price) |
| **Customer** | Buyer identity (name, email). Lightweight since no auth required. |
| **MerchantConfig** | Singleton config: Mural account ID, COP bank details (counterparty ID, payout method ID), wallet address |
| **Withdrawal** | Tracks each USDC-to-COP payout request. Links to the Mural payout request ID and stores status |

### Mural API Entities (external, accessed via API)

| Entity | Purpose |
|--------|---------|
| **Account** | Merchant's Mural account holding USDC on Polygon. Has a wallet address for receiving deposits. |
| **Transaction** | Mural's record of deposits and payouts on the account |
| **Counterparty** | The merchant themselves as a payout recipient (for COP withdrawal) |
| **Payout Method** | COP bank account details attached to the counterparty |
| **Payout Request** | A request to convert USDC and send COP to the merchant's bank |
| **Webhook** | Push notifications from Mural for balance changes and payout status updates |

---

## Entity Relationship Diagram

```
+──────────────────────────────────────────────────────────────────────────────+
│                           LOCAL DATABASE                                     │
│                                                                              │
│  ┌──────────┐       ┌──────────┐       ┌────────────┐                        │
│  │ Customer │──1:N──│  Order   │──1:N──│ OrderItem  │                        │
│  │          │       │          │       │            │                        │
│  │ id       │       │ id       │       │ id         │                        │
│  │ name     │       │ customerId│      │ orderId    │                        │
│  │ email    │       │ status   │       │ productId  │                        │
│  └──────────┘       │ totalUsdc│       │ quantity   │                        │
│                     │ walletAddr│      │ priceUsdc  │                        │
│                     │ txHash   │       └─────┬──────┘                        │
│                     │ createdAt│             │                               │
│                     └────┬─────┘        ┌────┴──────┐                        │
│                          │              │  Product  │                        │
│                          │              │           │                        │
│                          │              │ id        │                        │
│                     ┌────┴─────┐        │ name      │                        │
│                     │Withdrawal│        │ priceUsdc │                        │
│                     │          │        │ description│                       │
│                     │ id       │        │ stock     │                        │
│                     │ orderId  │        └───────────┘                        │
│                     │ muralPayoutId                                          │
│                     │ status   │                                             │
│                     │ copAmount│        ┌──────────────┐                     │
│                     │ exchangeRate      │MerchantConfig│                     │
│                     └──────────┘        │              │                     │
│                                         │ muralAccountId                     │
│                                         │ counterpartyId                     │
│                                         │ payoutMethodId                     │
│                                         │ walletAddress │                    │
│                                         └──────────────┘                     │
+──────────────────────────────────────────────────────────────────────────────+

                              │ API calls │
                              ▼           ▼

+──────────────────────────────────────────────────────────────────────────────+
│                         MURAL PAY API (Sandbox)                              │
│                                                                              │
│  ┌───────────┐    ┌──────────────┐    ┌──────────────┐    ┌───────────┐      │
│  │  Account  │    │ Counterparty │    │ Payout Method│    │  Webhook  │      │
│  │  (USDC)   │    │ (Merchant)   │────│  (COP bank)  │    │ (events)  │      │
│  │           │    └──────────────┘    └──────────────┘    └───────────┘      │
│  │ wallet    │                                                               │
│  │ address   │    ┌──────────────┐    ┌──────────────┐                       │
│  │ balances  │    │Payout Request│    │ Transaction  │                       │
│  └───────────┘    │ (USDC→COP)  │    │ (deposits &  │                       │
│                   │              │    │  payouts)    │                       │
│                   │ create →     │    └──────────────┘                       │
│                   │ execute →    │                                            │
│                   │ completed    │                                            │
│                   └──────────────┘                                            │
+──────────────────────────────────────────────────────────────────────────────+
```

---

## Core Flows

### Flow 1: Product Catalog
```
Client                      Our Backend                  Database
  │                              │                          │
  │  GET /products               │                          │
  │─────────────────────────────>│  SELECT * FROM products  │
  │                              │─────────────────────────>│
  │  <── product list ───────────│<─────────────────────────│
```
Simple CRUD. Products are seeded or managed via admin endpoints.

---

### Flow 2: Customer Checkout & Payment Collection
```
Client                      Our Backend                  Database              Mural API
  │                              │                          │                      │
  │ POST /orders                 │                          │                      │
  │ {items, customer}            │                          │                      │
  │─────────────────────────────>│                          │                      │
  │                              │  Create Order            │                      │
  │                              │  (status: PENDING)       │                      │
  │                              │─────────────────────────>│                      │
  │                              │                          │                      │
  │                              │  GET /api/accounts       │                      │
  │                              │  (get wallet address)    │                      │
  │                              │─────────────────────────────────────────────────>│
  │                              │<─────────────────────────────────────────────────│
  │                              │                          │                      │
  │  <── Order + wallet address  │                          │                      │
  │      + USDC amount to send   │                          │                      │
  │                              │                          │                      │
  │  (Customer sends USDC        │                          │                      │
  │   externally on Polygon)     │                          │                      │
```

**Response to customer includes:**
- Order ID
- Merchant wallet address (Polygon)
- Exact USDC amount to send
- Order expiry time

---

### Flow 3: Payment Detection (Webhook + Polling Hybrid)
```
Polygon Chain          Mural API                    Our Backend                    Database
     │                      │                            │                            │
     │  USDC transfer       │                            │                            │
     │─────────────────────>│                            │                            │
     │                      │                            │                            │
     │                      │  Webhook: BALANCE_ACTIVITY │                            │
     │                      │  (deposit detected)        │                            │
     │                      │───────────────────────────>│                            │
     │                      │                            │                            │
     │                      │                            │  Search transactions       │
     │                      │  GET transactions/search   │  to match deposit amount   │
     │                      │<───────────────────────────│  to pending order          │
     │                      │───────────────────────────>│                            │
     │                      │                            │                            │
     │                      │                            │  Match deposit → order     │
     │                      │                            │  Update order: PAID        │
     │                      │                            │─────────────────────────── │
     │                      │                            │                            │
     │                      │                            │  >>> Trigger Flow 4 >>>    │
```

**Matching strategy:** When a deposit webhook arrives, search recent transactions for deposits. Match by amount (exact USDC match to a pending order). This is the simplest approach but has known pitfalls documented in the README (two orders with the same amount, partial payments, etc.).

**Backup polling:** A cron job every ~60s polls Mural transactions to catch any missed webhooks.

---

### Flow 4: Automatic Fund Conversion & COP Withdrawal
```
Our Backend                                    Mural API                         Database
     │                                              │                                │
     │  (Triggered by payment detection)            │                                │
     │                                              │                                │
     │  POST /api/payouts/payout                    │                                │
     │  {sourceAccountId, payouts: [{               │                                │
     │    amount: {tokenAmount, "USDC"},             │                                │
     │    payoutDetails: {type: "fiat",              │                                │
     │      fiatAndRailDetails: {type: "cop", ...}}, │                                │
     │    recipientInfo: {counterpartyId}            │                                │
     │  }]}                                          │                                │
     │──────────────────────────────────────────────>│                                │
     │  <── PayoutRequest (AWAITING_EXECUTION) ──────│                                │
     │                                              │                                │
     │  Create Withdrawal record                    │                                │
     │──────────────────────────────────────────────────────────────────────────────>│
     │                                              │                                │
     │  POST /api/payouts/payout/{id}/execute       │                                │
     │  {exchangeRateToleranceMode: "FLEXIBLE"}     │                                │
     │──────────────────────────────────────────────>│                                │
     │  <── PayoutRequest (PENDING/EXECUTED) ────────│                                │
     │                                              │                                │
     │  Update Withdrawal status                    │                                │
     │──────────────────────────────────────────────────────────────────────────────>│
     │                                              │                                │
     │              ... time passes ...             │                                │
     │                                              │                                │
     │  Webhook: PAYOUT_REQUEST status change       │                                │
     │  (payout completed/failed)                   │                                │
     │<──────────────────────────────────────────────│                                │
     │                                              │                                │
     │  Update Withdrawal & Order status            │                                │
     │──────────────────────────────────────────────────────────────────────────────>│
```

---

### Flow 5: Merchant Views Orders & Withdrawals
```
Merchant                    Our Backend                  Database
  │                              │                          │
  │  GET /merchant/orders        │                          │
  │─────────────────────────────>│  SELECT orders + status  │
  │                              │─────────────────────────>│
  │  <── orders with payment     │<─────────────────────────│
  │      status & confirmation   │                          │
  │                              │                          │
  │  GET /merchant/withdrawals   │                          │
  │─────────────────────────────>│  SELECT withdrawals      │
  │                              │─────────────────────────>│
  │  <── withdrawals with        │<─────────────────────────│
  │      COP amounts & status    │                          │
```

---

## API Endpoints (Our Backend)

### Customer Endpoints
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/products` | List all products |
| `GET` | `/products/:id` | Get single product |
| `POST` | `/orders` | Create order (checkout) |
| `GET` | `/orders/:id` | Get order status (payment status) |

### Merchant Endpoints
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/merchant/orders` | List all orders with payment status |
| `GET` | `/merchant/orders/:id` | Single order detail with payment confirmation |
| `GET` | `/merchant/withdrawals` | List all COP withdrawals with status |
| `GET` | `/merchant/withdrawals/:id` | Single withdrawal detail |

### Webhook Endpoint
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/webhooks/mural` | Receive Mural webhook events |

### Admin/Setup Endpoints
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/admin/products` | Create a product |
| `POST` | `/admin/setup` | Initialize Mural counterparty + payout method + webhook |

---

## Tech Stack Recommendation

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Runtime** | Node.js / TypeScript | Fast to build, widely deployed |
| **Framework** | Express or Fastify | Lightweight, well-documented |
| **Database** | PostgreSQL | Relational, production-grade, supports complex queries |
| **DB Client** | pg (raw queries) | Lightweight, no ORM overhead |
| **Deployment** | Railway or Render | Easy deploy, free tier, public URL |
| **Scheduler** | node-cron (in-process) | For backup polling of transactions |

---

## Order Lifecycle State Machine

```
                    ┌─────────────────┐
                    │ PENDING_PAYMENT  │  (order created, waiting for USDC)
                    └────────┬────────┘
                             │
                    (deposit detected & matched)
                             │
                    ┌────────▼────────┐
                    │      PAID       │  (USDC received, payout initiated)
                    └────────┬────────┘
                             │
                    (payout request executed)
                             │
                    ┌────────▼────────┐
                    │ PAYOUT_PENDING  │  (COP conversion in progress)
                    └────────┬────────┘
                             │
                    (Mural confirms COP delivered)
                             │
                    ┌────────▼────────┐
                    │ PAYOUT_COMPLETE │  (COP received in bank)
                    └────────┬────────┘

        ── Error paths ──

                    ┌─────────────────┐
                    │     EXPIRED     │  (payment not received in time)
                    └─────────────────┘

                    ┌─────────────────┐
                    │  PAYOUT_FAILED  │  (COP transfer failed, refund)
                    └─────────────────┘
```

---

## Withdrawal (Payout) Status Machine

```
  INITIATED  →  AWAITING_EXECUTION  →  PENDING  →  COMPLETED
                                          │
                                          └──→  FAILED / REFUNDED
```

---

## Key Design Decisions & Pitfalls

### Payment Matching (README section)
- **Approach:** Match incoming USDC deposits to pending orders by exact amount
- **Pitfall 1:** Two orders with the same USDC total are ambiguous. Mitigation: use unique amounts (add small random cents) or match by timestamp (FIFO)
- **Pitfall 2:** Customer sends wrong amount. Mitigation: only match exact amounts; flag partial/excess payments for manual review
- **Pitfall 3:** Customer sends payment after order expires. Mitigation: still detect it, mark for manual refund
- **Pitfall 4:** Webhook delivery failure. Mitigation: backup polling cron

### Mural API Setup (one-time)
1. Create/use existing Mural Account (get wallet address)
2. Create Counterparty (the merchant's Colombian entity)
3. Create Payout Method on that counterparty (COP bank details)
4. Register Webhook for `MURAL_ACCOUNT_BALANCE_ACTIVITY` and `PAYOUT_REQUEST`
5. Activate the webhook

### COP Payout Details Required
```json
{
  "type": "cop",
  "symbol": "COP",
  "phoneNumber": "+573001234567",
  "accountType": "CHECKING",
  "bankAccountNumber": "1234567890",
  "documentNumber": "1234567890",
  "documentType": "NATIONAL_ID"
}
```

---

## Estimated Effort Breakdown (3 hours)

| Task | Time |
|------|------|
| Project scaffolding + DB schema + migrations | 30 min |
| Product catalog endpoints | 15 min |
| Order creation (checkout flow) | 20 min |
| Mural integration service (accounts, payouts, transactions) | 30 min |
| Webhook handler + payment matching | 30 min |
| Auto-conversion flow (create + execute payout) | 20 min |
| Merchant order & withdrawal endpoints | 15 min |
| Setup/seed script + one-time Mural config | 15 min |
| OpenAPI spec generation | 10 min |
| Deploy + test + README | 15 min |
| **Total** | **~3 hours** |
