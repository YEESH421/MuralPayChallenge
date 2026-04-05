import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export function merchantAuth(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['x-api-key'];
  if (!key || key !== config.merchantApiSecret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}
