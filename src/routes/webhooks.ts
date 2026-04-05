import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { db } from '../db';
import { MERCHANT_CONFIG_ID, WEBHOOK_CATEGORIES } from '../config';
import { matchDeposits } from '../services/orderService';
import { syncPayoutStatus } from '../services/payoutService';

export const webhooksRouter = Router();

function verifyMuralSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  publicKeyPem: string | undefined,
): boolean {
  if (!publicKeyPem || !signatureHeader) return false;
  try {
    const signature = Buffer.from(signatureHeader, 'base64');
    const verify = crypto.createVerify('SHA256');
    verify.update(rawBody);
    return verify.verify(
      { key: publicKeyPem, format: 'pem', dsaEncoding: 'ieee-p1363' },
      signature,
    );
  } catch {
    return false;
  }
}

webhooksRouter.post('/', async (req: Request, res: Response) => {
  res.status(200).json({ received: true });

  const rawBody: Buffer =
    (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body));
  const signatureHeader = req.headers['mural-signature'] as string | undefined;

  const merchantConfig = await db.merchantConfig.findUnique({ where: { id: MERCHANT_CONFIG_ID } });
  const publicKey = merchantConfig?.webhookPublicKey ?? undefined;

  const isValid = verifyMuralSignature(rawBody, signatureHeader, publicKey);
  if (!isValid) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[webhook] Invalid signature — rejecting event');
      return;
    }
    console.warn('[webhook] Signature verification failed (continuing in non-production mode)');
  }

  const body = req.body as { category?: string; payoutRequestId?: unknown };
  console.log(`[webhook] Received event: ${body.category ?? 'unknown'}`);

  try {
    if (body.category === WEBHOOK_CATEGORIES.BALANCE_ACTIVITY) {
      await matchDeposits();
    } else if (body.category === WEBHOOK_CATEGORIES.PAYOUT_REQUEST) {
      const payoutRequestId = typeof body.payoutRequestId === 'string' ? body.payoutRequestId : null;
      if (payoutRequestId) {
        await syncPayoutStatus(payoutRequestId);
      }
    }
  } catch (err) {
    console.error('[webhook] Handler error:', err);
  }
});
