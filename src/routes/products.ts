import { Router, Request, Response } from 'express';
import { pool } from '../db';

export const productsRouter = Router();

productsRouter.get('/', async (_req: Request, res: Response) => {
  const { rows } = await pool.query(
    'SELECT * FROM "Product" WHERE "isActive" = TRUE ORDER BY "createdAt" ASC',
  );
  res.json(rows);
});

productsRouter.get('/:id', async (req: Request, res: Response) => {
  const { rows } = await pool.query('SELECT * FROM "Product" WHERE id = $1', [
    String(req.params.id),
  ]);
  const product = rows[0];
  if (!product || !product.isActive) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  res.json(product);
});
