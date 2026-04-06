import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { merchantAuth } from '../middleware/auth';
import {
  formatOrderListItem,
  formatOrderDetail,
  formatWithdrawalListItem,
  formatWithdrawalFullDetail,
} from '../utils/formatters';
import { OrderWithAll, WithdrawalWithOrder } from '../types';

export const merchantRouter = Router();
merchantRouter.use(merchantAuth);

async function fetchOrderWithAll(orderId: string): Promise<OrderWithAll | null> {
  const { rows: orderRows } = await pool.query(
    `SELECT o.*, c.id AS c_id, c.name AS c_name, c.email AS c_email, c."createdAt" AS c_created,
            w.id AS w_id, w."muralPayoutReqId", w."muralPayoutId", w.status AS w_status,
            w."usdcAmount", w."copAmount", w."exchangeRate", w."createdAt" AS w_created, w."updatedAt" AS w_updated
     FROM "Order" o
     JOIN "Customer" c ON c.id = o."customerId"
     LEFT JOIN "Withdrawal" w ON w."orderId" = o.id
     WHERE o.id = $1`,
    [orderId],
  );
  const row = orderRows[0];
  if (!row) return null;

  const { rows: itemRows } = await pool.query(
    `SELECT oi.*, p.id AS p_id, p.name AS p_name, p.description, p."priceUsdc" AS p_price,
            p."imageUrl", p.stock, p."isActive", p."createdAt" AS p_created, p."updatedAt" AS p_updated
     FROM "OrderItem" oi JOIN "Product" p ON p.id = oi."productId"
     WHERE oi."orderId" = $1`,
    [orderId],
  );

  return buildOrderWithAll(row, itemRows);
}

function buildOrderWithAll(row: Record<string, unknown>, itemRows: Record<string, unknown>[]): OrderWithAll {
  return {
    id: row.id as string,
    customerId: row.customerId as string,
    status: row.status as OrderWithAll['status'],
    totalUsdc: Number(row.totalUsdc),
    walletAddress: row.walletAddress as string,
    paymentTxHash: row.paymentTxHash as string | null,
    muralTransactionId: row.muralTransactionId as string | null,
    expiresAt: row.expiresAt as Date,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
    customer: {
      id: row.c_id as string,
      name: row.c_name as string,
      email: row.c_email as string,
      createdAt: row.c_created as Date,
    },
    items: itemRows.map((i) => ({
      id: i.id as string,
      orderId: row.id as string,
      productId: i.productId as string,
      quantity: i.quantity as number,
      priceUsdc: Number(i.priceUsdc),
      product: {
        id: i.p_id as string,
        name: i.p_name as string,
        description: i.description as string | null,
        priceUsdc: Number(i.p_price),
        imageUrl: i.imageUrl as string | null,
        stock: i.stock as number,
        isActive: i.isActive as boolean,
        createdAt: i.p_created as Date,
        updatedAt: i.p_updated as Date,
      },
    })),
    withdrawal: row.w_id
      ? {
          id: row.w_id as string,
          orderId: row.id as string,
          muralPayoutReqId: row.muralPayoutReqId as string,
          muralPayoutId: row.muralPayoutId as string | null,
          status: row.w_status as WithdrawalWithOrder['status'],
          usdcAmount: Number(row.usdcAmount),
          copAmount: row.copAmount != null ? Number(row.copAmount) : null,
          exchangeRate: row.exchangeRate != null ? Number(row.exchangeRate) : null,
          createdAt: row.w_created as Date,
          updatedAt: row.w_updated as Date,
        }
      : null,
  };
}

merchantRouter.get('/orders', async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit)) || 50, 500);
  const skip = parseInt(String(req.query.skip)) || 0;

  const [{ rows: orderRows }, { rows: countRows }] = await Promise.all([
    pool.query(
      `SELECT o.*, c.id AS c_id, c.name AS c_name, c.email AS c_email, c."createdAt" AS c_created,
              w.id AS w_id, w."muralPayoutReqId", w."muralPayoutId", w.status AS w_status,
              w."usdcAmount", w."copAmount", w."exchangeRate", w."createdAt" AS w_created, w."updatedAt" AS w_updated
       FROM "Order" o
       JOIN "Customer" c ON c.id = o."customerId"
       LEFT JOIN "Withdrawal" w ON w."orderId" = o.id
       ORDER BY o."createdAt" DESC
       LIMIT $1 OFFSET $2`,
      [limit, skip],
    ),
    pool.query('SELECT COUNT(*) FROM "Order"'),
  ]);

  if (!orderRows.length) {
    res.json({ total: Number(countRows[0].count), limit, skip, orders: [] });
    return;
  }

  const orderIds = orderRows.map((r) => r.id);
  const { rows: allItems } = await pool.query(
    `SELECT oi.*, p.id AS p_id, p.name AS p_name, p.description, p."priceUsdc" AS p_price,
            p."imageUrl", p.stock, p."isActive", p."createdAt" AS p_created, p."updatedAt" AS p_updated
     FROM "OrderItem" oi JOIN "Product" p ON p.id = oi."productId"
     WHERE oi."orderId" = ANY($1::text[])`,
    [orderIds],
  );

  const itemsByOrder = new Map<string, typeof allItems>();
  for (const item of allItems) {
    const list = itemsByOrder.get(item.orderId) ?? [];
    list.push(item);
    itemsByOrder.set(item.orderId, list);
  }

  const orders: OrderWithAll[] = orderRows.map((row) =>
    buildOrderWithAll(row, itemsByOrder.get(row.id) ?? []),
  );

  res.json({ total: Number(countRows[0].count), limit, skip, orders: orders.map(formatOrderListItem) });
});

merchantRouter.get('/orders/:id', async (req: Request, res: Response) => {
  const order = await fetchOrderWithAll(String(req.params.id));
  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }
  res.json(formatOrderDetail(order));
});

merchantRouter.get('/withdrawals', async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit)) || 50, 500);
  const skip = parseInt(String(req.query.skip)) || 0;

  const [{ rows: wRows }, { rows: countRows }] = await Promise.all([
    pool.query(
      `SELECT w.*, o.id AS o_id, o.status AS o_status, o."totalUsdc" AS o_usdc,
              o."walletAddress", o."paymentTxHash", o."muralTransactionId",
              o."expiresAt", o."createdAt" AS o_created, o."updatedAt" AS o_updated,
              o."customerId",
              c.id AS c_id, c.name AS c_name, c.email AS c_email, c."createdAt" AS c_created
       FROM "Withdrawal" w
       JOIN "Order" o ON o.id = w."orderId"
       JOIN "Customer" c ON c.id = o."customerId"
       ORDER BY w."createdAt" DESC
       LIMIT $1 OFFSET $2`,
      [limit, skip],
    ),
    pool.query('SELECT COUNT(*) FROM "Withdrawal"'),
  ]);

  const withdrawals: WithdrawalWithOrder[] = wRows.map((row) => buildWithdrawalWithOrder(row));
  res.json({ total: Number(countRows[0].count), limit, skip, withdrawals: withdrawals.map(formatWithdrawalListItem) });
});

merchantRouter.get('/withdrawals/:id', async (req: Request, res: Response) => {
  const { rows } = await pool.query(
    `SELECT w.*, o.id AS o_id, o.status AS o_status, o."totalUsdc" AS o_usdc,
            o."walletAddress", o."paymentTxHash", o."muralTransactionId",
            o."expiresAt", o."createdAt" AS o_created, o."updatedAt" AS o_updated,
            o."customerId",
            c.id AS c_id, c.name AS c_name, c.email AS c_email, c."createdAt" AS c_created
     FROM "Withdrawal" w
     JOIN "Order" o ON o.id = w."orderId"
     JOIN "Customer" c ON c.id = o."customerId"
     WHERE w.id = $1`,
    [String(req.params.id)],
  );
  if (!rows[0]) {
    res.status(404).json({ error: 'Withdrawal not found' });
    return;
  }
  res.json(formatWithdrawalFullDetail(buildWithdrawalWithOrder(rows[0])));
});

function buildWithdrawalWithOrder(row: Record<string, unknown>): WithdrawalWithOrder {
  return {
    id: row.id as string,
    orderId: row.orderId as string,
    muralPayoutReqId: row.muralPayoutReqId as string,
    muralPayoutId: row.muralPayoutId as string | null,
    status: row.status as WithdrawalWithOrder['status'],
    usdcAmount: Number(row.usdcAmount),
    copAmount: row.copAmount != null ? Number(row.copAmount) : null,
    exchangeRate: row.exchangeRate != null ? Number(row.exchangeRate) : null,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
    order: {
      id: row.o_id as string,
      customerId: row.customerId as string,
      status: row.o_status as WithdrawalWithOrder['order']['status'],
      totalUsdc: Number(row.o_usdc),
      walletAddress: row.walletAddress as string,
      paymentTxHash: row.paymentTxHash as string | null,
      muralTransactionId: row.muralTransactionId as string | null,
      expiresAt: row.expiresAt as Date,
      createdAt: row.o_created as Date,
      updatedAt: row.o_updated as Date,
      customer: {
        id: row.c_id as string,
        name: row.c_name as string,
        email: row.c_email as string,
        createdAt: row.c_created as Date,
      },
    },
  };
}
