import { pool } from './db';

export async function initDb(): Promise<void> {
  await pool.query(`
    DO $$ BEGIN
      CREATE TYPE "OrderStatus" AS ENUM (
        'PENDING_PAYMENT', 'PAID', 'PAYOUT_PENDING', 'PAYOUT_COMPLETE', 'PAYOUT_FAILED', 'EXPIRED'
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    DO $$ BEGIN
      CREATE TYPE "WithdrawalStatus" AS ENUM (
        'INITIATED', 'AWAITING_EXECUTION', 'PENDING', 'COMPLETED', 'FAILED', 'REFUND_IN_PROGRESS', 'REFUNDED'
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    CREATE TABLE IF NOT EXISTS "Product" (
      id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name        TEXT NOT NULL,
      description TEXT,
      "priceUsdc" DOUBLE PRECISION NOT NULL,
      "imageUrl"  TEXT,
      stock       INTEGER NOT NULL DEFAULT -1,
      "isActive"  BOOLEAN NOT NULL DEFAULT TRUE,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS "Customer" (
      id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name        TEXT NOT NULL,
      email       TEXT NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS "Order" (
      id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "customerId"         TEXT NOT NULL REFERENCES "Customer"(id),
      status               "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
      "totalUsdc"          DOUBLE PRECISION NOT NULL,
      "walletAddress"      TEXT NOT NULL,
      "paymentTxHash"      TEXT,
      "muralTransactionId" TEXT UNIQUE,
      "expiresAt"          TIMESTAMPTZ NOT NULL,
      "createdAt"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS "OrderItem" (
      id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "orderId"   TEXT NOT NULL REFERENCES "Order"(id),
      "productId" TEXT NOT NULL REFERENCES "Product"(id),
      quantity    INTEGER NOT NULL,
      "priceUsdc" DOUBLE PRECISION NOT NULL
    );

    CREATE TABLE IF NOT EXISTS "Withdrawal" (
      id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "orderId"         TEXT NOT NULL UNIQUE REFERENCES "Order"(id),
      "muralPayoutReqId" TEXT NOT NULL,
      "muralPayoutId"   TEXT,
      status            "WithdrawalStatus" NOT NULL DEFAULT 'INITIATED',
      "usdcAmount"      DOUBLE PRECISION NOT NULL,
      "copAmount"       DOUBLE PRECISION,
      "exchangeRate"    DOUBLE PRECISION,
      "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS "MerchantConfig" (
      id                TEXT PRIMARY KEY,
      "muralAccountId"  TEXT NOT NULL,
      "walletAddress"   TEXT NOT NULL,
      "counterpartyId"  TEXT,
      "payoutMethodId"  TEXT,
      "webhookId"       TEXT,
      "webhookPublicKey" TEXT,
      "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  console.log('[db] Schema initialized');
}
