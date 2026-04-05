import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { db } from '../db';
import { config, MERCHANT_CONFIG_ID } from '../config';
import { formatOrderItems, formatWithdrawalSummary } from '../utils/formatters';

export const ordersRouter = Router();

type OrderWithRelations = Prisma.OrderGetPayload<{
  include: { customer: true; items: { include: { product: true } }; withdrawal: true };
}>;

ordersRouter.post('/', async (req: Request, res: Response) => {
  const { customer, items } = req.body as {
    customer: { name: string; email: string };
    items: Array<{ productId: string; quantity: number }>;
  };

  if (!customer?.name || !customer?.email) {
    res.status(400).json({ error: 'customer.name and customer.email are required' });
    return;
  }
  if (!items?.length) {
    res.status(400).json({ error: 'items must be a non-empty array' });
    return;
  }

  const merchantConfig = await db.merchantConfig.findUnique({ where: { id: MERCHANT_CONFIG_ID } });
  if (!merchantConfig) {
    res.status(503).json({ error: 'Merchant not configured. Run setup first.' });
    return;
  }

  const productIds = items.map((i) => i.productId);
  const products = await db.product.findMany({ where: { id: { in: productIds }, isActive: true } });

  if (products.length !== productIds.length) {
    res.status(400).json({ error: 'One or more products not found or inactive' });
    return;
  }

  // O(1) lookup instead of O(n) find per item
  const productMap = new Map(products.map((p) => [p.id, p]));

  let totalUsdc = 0;
  const lineItems = items.map((item) => {
    const product = productMap.get(item.productId)!;
    totalUsdc += Number(product.priceUsdc) * item.quantity;
    return { productId: product.id, quantity: item.quantity, priceUsdc: Number(product.priceUsdc) };
  });

  totalUsdc = Math.round(totalUsdc * 1_000_000) / 1_000_000;

  const expiresAt = new Date(Date.now() + config.orderExpiryHours * 60 * 60 * 1000);

  const order = await db.$transaction(async (tx) => {
    const c = await tx.customer.create({ data: { name: customer.name, email: customer.email } });
    return tx.order.create({
      data: {
        customerId: c.id,
        totalUsdc,
        walletAddress: merchantConfig.walletAddress,
        expiresAt,
        items: { create: lineItems },
      },
      include: { items: { include: { product: true } }, customer: true },
    });
  });

  res.status(201).json({
    orderId: order.id,
    status: order.status,
    totalUsdc: order.totalUsdc,
    walletAddress: order.walletAddress,
    blockchain: 'POLYGON',
    tokenSymbol: 'USDC',
    expiresAt: order.expiresAt,
    instructions: `Send exactly ${totalUsdc} USDC on Polygon to ${merchantConfig.walletAddress}`,
    customer: { name: order.customer.name, email: order.customer.email },
    items: formatOrderItems(order.items),
  });
});

ordersRouter.get('/:id', async (req: Request, res: Response) => {
  const order = (await db.order.findUnique({
    where: { id: String(req.params.id) },
    include: { customer: true, items: { include: { product: true } }, withdrawal: true },
  })) as OrderWithRelations | null;

  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  res.json({
    orderId: order.id,
    status: order.status,
    totalUsdc: order.totalUsdc,
    walletAddress: order.walletAddress,
    blockchain: 'POLYGON',
    tokenSymbol: 'USDC',
    expiresAt: order.expiresAt,
    paymentTxHash: order.paymentTxHash,
    createdAt: order.createdAt,
    customer: { name: order.customer.name, email: order.customer.email },
    items: formatOrderItems(order.items, true),
    withdrawal: formatWithdrawalSummary(order.withdrawal),
  });
});

