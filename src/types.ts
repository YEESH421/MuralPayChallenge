export type OrderStatus = 'PENDING_PAYMENT' | 'PAID' | 'PAYOUT_PENDING' | 'PAYOUT_COMPLETE' | 'PAYOUT_FAILED' | 'EXPIRED';
export type WithdrawalStatus = 'INITIATED' | 'AWAITING_EXECUTION' | 'PENDING' | 'COMPLETED' | 'FAILED' | 'REFUND_IN_PROGRESS' | 'REFUNDED';

export interface Product {
  id: string;
  name: string;
  description: string | null;
  priceUsdc: number;
  imageUrl: string | null;
  stock: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

export interface Order {
  id: string;
  customerId: string;
  status: OrderStatus;
  totalUsdc: number;
  walletAddress: string;
  paymentTxHash: string | null;
  muralTransactionId: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  priceUsdc: number;
}

export interface OrderItemWithProduct extends OrderItem {
  product: Product;
}

export interface Withdrawal {
  id: string;
  orderId: string;
  muralPayoutReqId: string;
  muralPayoutId: string | null;
  status: WithdrawalStatus;
  usdcAmount: number;
  copAmount: number | null;
  exchangeRate: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MerchantConfig {
  id: string;
  muralAccountId: string;
  walletAddress: string;
  counterpartyId: string | null;
  payoutMethodId: string | null;
  webhookId: string | null;
  webhookPublicKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderWithAll extends Order {
  customer: Customer;
  items: OrderItemWithProduct[];
  withdrawal: Withdrawal | null;
}

export interface WithdrawalWithOrder extends Withdrawal {
  order: Order & { customer: Customer };
}
