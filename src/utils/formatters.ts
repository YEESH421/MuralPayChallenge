import { OrderWithAll, WithdrawalWithOrder, Withdrawal, OrderItemWithProduct } from '../types';

export function formatOrderItems(items: OrderItemWithProduct[], includeSubtotal = false) {
  return items.map((i) => ({
    productName: i.product.name,
    quantity: i.quantity,
    priceUsdc: i.priceUsdc,
    ...(includeSubtotal && { subtotal: Number(i.priceUsdc) * i.quantity }),
  }));
}

export function formatWithdrawalSummary(w: Withdrawal | null) {
  if (!w) return null;
  return {
    status: w.status,
    usdcAmount: w.usdcAmount,
    copAmount: w.copAmount,
    exchangeRate: w.exchangeRate,
  };
}

export function formatWithdrawalDetail(w: Withdrawal | null) {
  if (!w) return null;
  return {
    withdrawalId: w.id,
    muralPayoutReqId: w.muralPayoutReqId,
    status: w.status,
    usdcAmount: w.usdcAmount,
    copAmount: w.copAmount,
    exchangeRate: w.exchangeRate,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  };
}

export function formatOrderListItem(o: OrderWithAll) {
  return {
    orderId: o.id,
    status: o.status,
    totalUsdc: o.totalUsdc,
    customer: { name: o.customer.name, email: o.customer.email },
    paymentTxHash: o.paymentTxHash,
    walletAddress: o.walletAddress,
    expiresAt: o.expiresAt,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    items: formatOrderItems(o.items),
    withdrawal: o.withdrawal
      ? { withdrawalId: o.withdrawal.id, ...formatWithdrawalSummary(o.withdrawal) }
      : null,
  };
}

export function formatOrderDetail(o: OrderWithAll) {
  return {
    orderId: o.id,
    status: o.status,
    totalUsdc: o.totalUsdc,
    walletAddress: o.walletAddress,
    blockchain: 'POLYGON',
    tokenSymbol: 'USDC',
    paymentTxHash: o.paymentTxHash,
    muralTransactionId: o.muralTransactionId,
    expiresAt: o.expiresAt,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    customer: { name: o.customer.name, email: o.customer.email },
    items: formatOrderItems(o.items, true),
    withdrawal: formatWithdrawalDetail(o.withdrawal),
  };
}

export function formatWithdrawalListItem(w: WithdrawalWithOrder) {
  return {
    withdrawalId: w.id,
    orderId: w.orderId,
    muralPayoutReqId: w.muralPayoutReqId,
    status: w.status,
    usdcAmount: w.usdcAmount,
    copAmount: w.copAmount,
    exchangeRate: w.exchangeRate,
    customer: { name: w.order.customer.name, email: w.order.customer.email },
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  };
}

export function formatWithdrawalFullDetail(w: WithdrawalWithOrder) {
  return {
    withdrawalId: w.id,
    orderId: w.orderId,
    muralPayoutReqId: w.muralPayoutReqId,
    muralPayoutId: w.muralPayoutId,
    status: w.status,
    usdcAmount: w.usdcAmount,
    copAmount: w.copAmount,
    exchangeRate: w.exchangeRate,
    customer: { name: w.order.customer.name, email: w.order.customer.email },
    orderStatus: w.order.status,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  };
}
