import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { config, MERCHANT_CONFIG_ID } from '../config';
import { formatOrderItems, formatWithdrawalSummary } from '../utils/formatters';
import { Product, MerchantConfig, OrderItemWithProduct } from '../types';

export const ordersRouter = Router();

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

  const { rows: configRows } = await pool.query<MerchantConfig>(
    'SELECT * FROM "MerchantConfig" WHERE id = $1',
    [MERCHANT_CONFIG_ID],
  );
  const merchantConfig = configRows[0];
  if (!merchantConfig) {
    res.status(503).json({ error: 'Merchant not configured. Run setup first.' });
    return;
  }

  const productIds = items.map((i) => i.productId);
  const { rows: products } = await pool.query<Product>(
    'SELECT * FROM "Product" WHERE id = ANY($1::text[]) AND "isActive" = TRUE',
    [productIds],
  );

  if (products.length !== productIds.length) {
    res.status(400).json({ error: 'One or more products not found or inactive' });
    return;
  }

  const productMap = new Map(products.map((p) => [p.id, p]));

  let totalUsdc = 0;
  const lineItems = items.map((item) => {
    const product = productMap.get(item.productId)!;
    totalUsdc += Number(product.priceUsdc) * item.quantity;
    return { productId: product.id, quantity: item.quantity, priceUsdc: Number(product.priceUsdc) };
  });
  totalUsdc = Math.round(totalUsdc * 1_000_000) / 1_000_000;

  const expiresAt = new Date(Date.now() + config.orderExpiryHours * 60 * 60 * 1000);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: customerRows } = await client.query(
      `INSERT INTO "Customer" (id, name, email) VALUES (gen_random_uuid()::text, $1, $2) RETURNING *`,
      [customer.name, customer.email],
    );
    const newCustomer = customerRows[0];

    const { rows: orderRows } = await client.query(
      `INSERT INTO "Order" (id, "customerId", "totalUsdc", "walletAddress", "expiresAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4) RETURNING *`,
      [newCustomer.id, totalUsdc, merchantConfig.walletAddress, expiresAt],
    );
    const order = orderRows[0];

    for (const li of lineItems) {
      await client.query(
        `INSERT INTO "OrderItem" (id, "orderId", "productId", quantity, "priceUsdc")
         VALUES (gen_random_uuid()::text, $1, $2, $3, $4)`,
        [order.id, li.productId, li.quantity, li.priceUsdc],
      );
    }

    await client.query('COMMIT');

    const orderItemsWithProducts: OrderItemWithProduct[] = lineItems.map((li) => ({
      id: '',
      orderId: order.id,
      productId: li.productId,
      quantity: li.quantity,
      priceUsdc: li.priceUsdc,
      product: productMap.get(li.productId)!,
    }));

    res.status(201).json({
      orderId: order.id,
      status: order.status,
      totalUsdc: order.totalUsdc,
      walletAddress: order.walletAddress,
      blockchain: 'POLYGON',
      tokenSymbol: 'USDC',
      expiresAt: order.expiresAt,
      instructions: `Send exactly ${totalUsdc} USDC on Polygon to ${merchantConfig.walletAddress}`,
      customer: { name: newCustomer.name, email: newCustomer.email },
      items: formatOrderItems(orderItemsWithProducts),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

ordersRouter.get('/:id', async (req: Request, res: Response) => {
  const orderId = String(req.params.id);

  const { rows: orderRows } = await pool.query(
    `SELECT o.*, c.name AS customer_name, c.email AS customer_email
     FROM "Order" o JOIN "Customer" c ON c.id = o."customerId"
     WHERE o.id = $1`,
    [orderId],
  );
  const order = orderRows[0];
  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  const [{ rows: itemRows }, { rows: withdrawalRows }] = await Promise.all([
    pool.query(
      `SELECT oi.*, p.name AS product_name FROM "OrderItem" oi
       JOIN "Product" p ON p.id = oi."productId" WHERE oi."orderId" = $1`,
      [orderId],
    ),
    pool.query('SELECT * FROM "Withdrawal" WHERE "orderId" = $1', [orderId]),
  ]);

  const withdrawal = withdrawalRows[0] ?? null;

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
    customer: { name: order.customer_name, email: order.customer_email },
    items: itemRows.map((i) => ({
      productName: i.product_name,
      quantity: i.quantity,
      priceUsdc: i.priceUsdc,
      subtotal: Number(i.priceUsdc) * i.quantity,
    })),
    withdrawal: formatWithdrawalSummary(withdrawal),
  });
});
