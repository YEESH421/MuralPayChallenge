import { Router, Request, Response } from 'express';
import { db } from '../db';

export const productsRouter = Router();

// GET /products — list all active products
productsRouter.get('/', async (_req: Request, res: Response) => {
  const products = await db.product.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  res.json(products);
});

// GET /products/:id — single product
productsRouter.get('/:id', async (req: Request, res: Response) => {
  const product = await db.product.findUnique({ where: { id: String(req.params.id) } });
  if (!product || !product.isActive) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  res.json(product);
});
