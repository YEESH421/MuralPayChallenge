import { MerchantConfig, OrderStatus, WithdrawalStatus } from '@prisma/client';
import { db } from '../db';
import * as mural from './mural';

export async function initiateWithdrawal(
  orderId: string,
  merchantConfig: MerchantConfig,
): Promise<void> {
  if (!merchantConfig.counterpartyId) {
    throw new Error('Merchant counterpartyId not configured — run setup first');
  }
  if (!merchantConfig.payoutMethodId) {
    throw new Error('Merchant payoutMethodId not configured — run setup first');
  }

  const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
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

  await db.withdrawal.create({
    data: {
      orderId,
      muralPayoutReqId: payoutReq.id,
      status: WithdrawalStatus.AWAITING_EXECUTION,
      usdcAmount,
    },
  });

  const executed = await mural.executePayoutRequest(payoutReq.id, 'FLEXIBLE');

  const firstPayout = executed.payouts[0];
  if (!firstPayout) {
    throw new Error(`No payouts returned in execute response for request ${payoutReq.id}`);
  }

  await Promise.all([
    db.withdrawal.update({
      where: { orderId },
      data: {
        status: WithdrawalStatus.PENDING,
        muralPayoutId: firstPayout.id,
        exchangeRate: firstPayout.details?.exchangeRate ?? undefined,
        copAmount: firstPayout.details?.fiatAmount?.fiatAmount ?? undefined,
      },
    }),
    db.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.PAYOUT_PENDING },
    }),
  ]);

  console.log(
    `[payoutService] Payout executed for order ${orderId}: ${usdcAmount} USDC → ` +
    `${firstPayout.details?.fiatAmount?.fiatAmount ?? '?'} COP`,
  );
}

function mapFiatStatus(muralStatus: string): WithdrawalStatus | null {
  const map: Record<string, WithdrawalStatus> = {
    created: WithdrawalStatus.AWAITING_EXECUTION,
    pending: WithdrawalStatus.PENDING,
    'on-hold': WithdrawalStatus.PENDING,
    completed: WithdrawalStatus.COMPLETED,
    canceled: WithdrawalStatus.FAILED,
    failed: WithdrawalStatus.FAILED,
    refundInProgress: WithdrawalStatus.REFUND_IN_PROGRESS,
    refunded: WithdrawalStatus.REFUNDED,
  };
  return map[muralStatus] ?? null;
}

export async function syncPayoutStatus(muralPayoutReqId: string): Promise<void> {
  const withdrawal = await db.withdrawal.findFirst({
    where: { muralPayoutReqId },
    include: { order: true },
  });
  if (!withdrawal) {
    console.warn(`[payoutService] No withdrawal found for payout request ${muralPayoutReqId}`);
    return;
  }

  const payoutReq = await mural.getPayoutRequest(muralPayoutReqId);
  const firstPayout = payoutReq.payouts[0];
  const fiatStatus = firstPayout?.details?.fiatPayoutStatus?.type;

  if (!fiatStatus) return;

  const newWithdrawalStatus = mapFiatStatus(fiatStatus);
  if (!newWithdrawalStatus) return;

  const updates: Promise<unknown>[] = [
    db.withdrawal.update({
      where: { id: withdrawal.id },
      data: {
        status: newWithdrawalStatus,
        copAmount: firstPayout?.details?.fiatAmount?.fiatAmount ?? undefined,
        exchangeRate: firstPayout?.details?.exchangeRate ?? undefined,
      },
    }),
  ];

  if (newWithdrawalStatus === WithdrawalStatus.COMPLETED) {
    updates.push(
      db.order.update({ where: { id: withdrawal.orderId }, data: { status: OrderStatus.PAYOUT_COMPLETE } }),
    );
  } else if (newWithdrawalStatus === WithdrawalStatus.FAILED || newWithdrawalStatus === WithdrawalStatus.REFUNDED) {
    updates.push(
      db.order.update({ where: { id: withdrawal.orderId }, data: { status: OrderStatus.PAYOUT_FAILED } }),
    );
  }

  await Promise.all(updates);
  console.log(`[payoutService] Payout ${muralPayoutReqId} status → ${newWithdrawalStatus}`);
}
