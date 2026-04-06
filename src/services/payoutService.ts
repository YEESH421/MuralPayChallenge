import { pool } from '../db';
import * as mural from './mural';
import { MerchantConfig, WithdrawalStatus } from '../types';

export async function initiateWithdrawal(orderId: string, merchantConfig: MerchantConfig): Promise<void> {
  if (!merchantConfig.counterpartyId) {
    throw new Error('Merchant counterpartyId not configured — run setup first');
  }
  if (!merchantConfig.payoutMethodId) {
    throw new Error('Merchant payoutMethodId not configured — run setup first');
  }

  const { rows } = await pool.query('SELECT * FROM "Order" WHERE id = $1', [orderId]);
  const order = rows[0];
  if (!order) throw new Error(`Order ${orderId} not found`);

  const usdcAmount = Number(order.totalUsdc);

  const payoutReq = await mural.createPayoutRequest({
    sourceAccountId: merchantConfig.muralAccountId,
    memo: `Order ${orderId}`,
    payouts: [
      {
        amount: { tokenAmount: usdcAmount, tokenSymbol: 'USDC' },
        payoutDetails: {
          type: 'counterpartyPayoutMethod',
          payoutMethodId: merchantConfig.payoutMethodId,
        },
        recipientInfo: {
          type: 'counterpartyInfo',
          counterpartyId: merchantConfig.counterpartyId,
        },
        supportingDetails: { payoutPurpose: 'VENDOR_PAYMENT' },
      },
    ],
  });

  await pool.query(
    `INSERT INTO "Withdrawal" (id, "orderId", "muralPayoutReqId", status, "usdcAmount")
     VALUES (gen_random_uuid()::text, $1, $2, 'AWAITING_EXECUTION', $3)`,
    [orderId, payoutReq.id, usdcAmount],
  );

  const executed = await mural.executePayoutRequest(payoutReq.id, 'FLEXIBLE');
  const firstPayout = executed.payouts[0];
  if (!firstPayout) {
    throw new Error(`No payouts returned for request ${payoutReq.id}`);
  }

  await Promise.all([
    pool.query(
      `UPDATE "Withdrawal"
       SET status = 'PENDING', "muralPayoutId" = $1, "exchangeRate" = $2, "copAmount" = $3, "updatedAt" = NOW()
       WHERE "orderId" = $4`,
      [
        firstPayout.id,
        firstPayout.details?.exchangeRate ?? null,
        firstPayout.details?.fiatAmount?.fiatAmount ?? null,
        orderId,
      ],
    ),
    pool.query(
      `UPDATE "Order" SET status = 'PAYOUT_PENDING', "updatedAt" = NOW() WHERE id = $1`,
      [orderId],
    ),
  ]);

  console.log(
    `[payoutService] Payout executed for order ${orderId}: ${usdcAmount} USDC → ` +
      `${firstPayout.details?.fiatAmount?.fiatAmount ?? '?'} COP`,
  );
}

function mapFiatStatus(muralStatus: string): WithdrawalStatus | null {
  const map: Record<string, WithdrawalStatus> = {
    created: 'AWAITING_EXECUTION',
    pending: 'PENDING',
    'on-hold': 'PENDING',
    completed: 'COMPLETED',
    canceled: 'FAILED',
    failed: 'FAILED',
    refundInProgress: 'REFUND_IN_PROGRESS',
    refunded: 'REFUNDED',
  };
  return map[muralStatus] ?? null;
}

export async function syncPayoutStatus(muralPayoutReqId: string): Promise<void> {
  const { rows } = await pool.query(
    'SELECT * FROM "Withdrawal" WHERE "muralPayoutReqId" = $1',
    [muralPayoutReqId],
  );
  const withdrawal = rows[0];
  if (!withdrawal) {
    console.warn(`[payoutService] No withdrawal found for payout request ${muralPayoutReqId}`);
    return;
  }

  const payoutReq = await mural.getPayoutRequest(muralPayoutReqId);
  const firstPayout = payoutReq.payouts[0];
  const fiatStatus = firstPayout?.details?.fiatPayoutStatus?.type;
  if (!fiatStatus) return;

  const newStatus = mapFiatStatus(fiatStatus);
  if (!newStatus) return;

  const updates: Promise<unknown>[] = [
    pool.query(
      `UPDATE "Withdrawal"
       SET status = $1, "copAmount" = $2, "exchangeRate" = $3, "updatedAt" = NOW()
       WHERE id = $4`,
      [
        newStatus,
        firstPayout?.details?.fiatAmount?.fiatAmount ?? null,
        firstPayout?.details?.exchangeRate ?? null,
        withdrawal.id,
      ],
    ),
  ];

  if (newStatus === 'COMPLETED') {
    updates.push(
      pool.query(
        `UPDATE "Order" SET status = 'PAYOUT_COMPLETE', "updatedAt" = NOW() WHERE id = $1`,
        [withdrawal.orderId],
      ),
    );
  } else if (newStatus === 'FAILED' || newStatus === 'REFUNDED') {
    updates.push(
      pool.query(
        `UPDATE "Order" SET status = 'PAYOUT_FAILED', "updatedAt" = NOW() WHERE id = $1`,
        [withdrawal.orderId],
      ),
    );
  }

  await Promise.all(updates);
  console.log(`[payoutService] Payout ${muralPayoutReqId} status → ${newStatus}`);
}
