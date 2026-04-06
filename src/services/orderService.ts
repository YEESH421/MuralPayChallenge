import { pool } from '../db';
import { MERCHANT_CONFIG_ID } from '../config';
import * as mural from './mural';
import { initiateWithdrawal } from './payoutService';
import { MerchantConfig } from '../types';

export async function matchDeposits(): Promise<void> {
  const { rows } = await pool.query<MerchantConfig>(
    'SELECT * FROM "MerchantConfig" WHERE id = $1',
    [MERCHANT_CONFIG_ID],
  );
  const merchantConfig = rows[0];
  if (!merchantConfig) return;

  const { results: transactions } = await mural.searchTransactions(merchantConfig.muralAccountId, 50);

  const deposits = transactions.filter((tx) => {
    const details = tx.transactionDetails as { type: string };
    return details.type === 'deposit';
  });

  if (!deposits.length) return;

  const depositIds = deposits.map((d) => d.id);
  const { rows: matchedRows } = await pool.query<{ muralTransactionId: string }>(
    'SELECT "muralTransactionId" FROM "Order" WHERE "muralTransactionId" = ANY($1::text[])',
    [depositIds],
  );
  const alreadyMatchedIds = new Set(matchedRows.map((r) => r.muralTransactionId));

  for (const deposit of deposits) {
    if (alreadyMatchedIds.has(deposit.id)) continue;

    const depositAmount = deposit.amount.tokenAmount;

    const { rows: orderRows } = await pool.query(
      `SELECT * FROM "Order"
       WHERE status = 'PENDING_PAYMENT'
         AND "totalUsdc" = $1
         AND "expiresAt" > NOW()
         AND "muralTransactionId" IS NULL
       ORDER BY "createdAt" ASC
       LIMIT 1`,
      [depositAmount],
    );
    const matchingOrder = orderRows[0];

    if (!matchingOrder) {
      console.log(`[orderService] No matching order for deposit ${deposit.id} (${depositAmount} USDC)`);
      continue;
    }

    console.log(`[orderService] Matched deposit ${deposit.id} → order ${matchingOrder.id} (${depositAmount} USDC)`);

    await pool.query(
      `UPDATE "Order" SET status = 'PAID', "muralTransactionId" = $1, "paymentTxHash" = $2, "updatedAt" = NOW()
       WHERE id = $3`,
      [deposit.id, deposit.hash, matchingOrder.id],
    );

    try {
      await initiateWithdrawal(matchingOrder.id, merchantConfig);
    } catch (err) {
      console.error(`[orderService] Payout initiation failed for order ${matchingOrder.id}:`, err);
      await pool.query(
        `UPDATE "Order" SET status = 'PAYOUT_FAILED', "updatedAt" = NOW() WHERE id = $1`,
        [matchingOrder.id],
      );
    }
  }
}
