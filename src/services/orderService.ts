import { OrderStatus } from '@prisma/client';
import { db } from '../db';
import { MERCHANT_CONFIG_ID } from '../config';
import * as mural from './mural';
import { initiateWithdrawal } from './payoutService';

export async function matchDeposits(): Promise<void> {
  const merchantConfig = await db.merchantConfig.findUnique({ where: { id: MERCHANT_CONFIG_ID } });
  if (!merchantConfig) return;

  const { results: transactions } = await mural.searchTransactions(merchantConfig.muralAccountId, 50);

  const deposits = transactions.filter((tx) => {
    const details = tx.transactionDetails as { type: string };
    return details.type === 'deposit';
  });

  if (!deposits.length) return;

  // Batch check: find all deposit IDs already matched to avoid N+1 per-deposit queries
  const depositIds = deposits.map((d) => d.id);
  const alreadyMatchedIds = new Set(
    (
      await db.order.findMany({
        where: { muralTransactionId: { in: depositIds } },
        select: { muralTransactionId: true },
      })
    ).map((o) => o.muralTransactionId as string),
  );

  for (const deposit of deposits) {
    if (alreadyMatchedIds.has(deposit.id)) continue;

    const depositAmount = deposit.amount.tokenAmount;

    // FIFO: oldest pending order with the exact USDC amount wins
    const matchingOrder = await db.order.findFirst({
      where: {
        status: OrderStatus.PENDING_PAYMENT,
        totalUsdc: depositAmount,
        expiresAt: { gt: new Date() },
        muralTransactionId: null,
      },
      orderBy: { createdAt: 'asc' },
    });

    if (!matchingOrder) {
      console.log(`[orderService] No matching order for deposit ${deposit.id} (${depositAmount} USDC)`);
      continue;
    }

    console.log(`[orderService] Matched deposit ${deposit.id} → order ${matchingOrder.id} (${depositAmount} USDC)`);

    await db.order.update({
      where: { id: matchingOrder.id },
      data: {
        status: OrderStatus.PAID,
        muralTransactionId: deposit.id,
        paymentTxHash: deposit.hash,
      },
    });

    try {
      await initiateWithdrawal(matchingOrder.id, merchantConfig);
    } catch (err) {
      console.error(`[orderService] Payout initiation failed for order ${matchingOrder.id}:`, err);
      await db.order.update({
        where: { id: matchingOrder.id },
        data: { status: OrderStatus.PAYOUT_FAILED },
      });
    }
  }
}
