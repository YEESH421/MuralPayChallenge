import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { db } from '../db';
import { merchantAuth } from '../middleware/auth';
import {
  formatOrderListItem,
  formatOrderDetail,
  formatWithdrawalListItem,
  formatWithdrawalFullDetail,
} from '../utils/formatters';

export const merchantRouter = Router();
merchantRouter.use(merchantAuth);

type OrderWithAll = Prisma.OrderGetPayload<{
  include: { customer: true; items: { include: { product: true } }; withdrawal: true };
}>;

type WithdrawalWithOrder = Prisma.WithdrawalGetPayload<{
  include: { order: { include: { customer: true } } };
}>;

merchantRouter.get('/orders', async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit)) || 50, 500);
  const skip = parseInt(String(req.query.skip)) || 0;

  const [orders, total] = await Promise.all([
    db.order.findMany({
      orderBy: { createdAt: 'desc' },
      include: { customer: true, items: { include: { product: true } }, withdrawal: true },
      take: limit,
      skip,
    }) as Promise<OrderWithAll[]>,
    db.order.count(),
  ]);

  res.json({ total, limit, skip, orders: orders.map(formatOrderListItem) });
});

merchantRouter.get('/orders/:id', async (req: Request, res: Response) => {
  const order = (await db.order.findUnique({
    where: { id: String(req.params.id) },
    include: { customer: true, items: { include: { product: true } }, withdrawal: true },
  })) as OrderWithAll | null;

  if (!order) {
    res.status(404).json({ error: 'Order not found' });
    return;
  }

  res.json(formatOrderDetail(order));
});

merchantRouter.get('/withdrawals', async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit)) || 50, 500);
  const skip = parseInt(String(req.query.skip)) || 0;

  const [withdrawals, total] = await Promise.all([
    db.withdrawal.findMany({
      orderBy: { createdAt: 'desc' },
      include: { order: { include: { customer: true } } },
      take: limit,
      skip,
    }) as Promise<WithdrawalWithOrder[]>,
    db.withdrawal.count(),
  ]);

  res.json({ total, limit, skip, withdrawals: withdrawals.map(formatWithdrawalListItem) });
});

merchantRouter.get('/withdrawals/:id', async (req: Request, res: Response) => {
  const w = (await db.withdrawal.findUnique({
    where: { id: String(req.params.id) },
    include: { order: { include: { customer: true } } },
  })) as WithdrawalWithOrder | null;

  if (!w) {
    res.status(404).json({ error: 'Withdrawal not found' });
    return;
  }

  res.json(formatWithdrawalFullDetail(w));
});
