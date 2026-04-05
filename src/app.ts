import express, { Request, Response, NextFunction } from 'express';
import { productsRouter } from './routes/products';
import { ordersRouter } from './routes/orders';
import { merchantRouter } from './routes/merchant';
import { webhooksRouter } from './routes/webhooks';
import { adminRouter } from './routes/admin';

export function createApp() {
  const app = express();

  // Capture raw body for webhook signature verification before JSON parsing
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (req.path === '/webhooks/mural') {
      let data = Buffer.alloc(0);
      req.on('data', (chunk: Buffer) => { data = Buffer.concat([data, chunk]); });
      req.on('end', () => {
        (req as Request & { rawBody: Buffer }).rawBody = data;
        next();
      });
    } else {
      next();
    }
  });

  app.use(express.json());

  // Health check
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // Routes
  app.use('/products', productsRouter);
  app.use('/orders', ordersRouter);
  app.use('/merchant', merchantRouter);
  app.use('/webhooks', webhooksRouter);
  app.use('/admin', adminRouter);

  // 404
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[error]', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
