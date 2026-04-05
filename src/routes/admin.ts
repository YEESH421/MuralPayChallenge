import { Router, Request, Response } from 'express';
import { db } from '../db';
import { merchantAuth } from '../middleware/auth';
import * as mural from '../services/mural';
import { config, MERCHANT_CONFIG_ID, WEBHOOK_CATEGORIES } from '../config';

export const adminRouter = Router();
adminRouter.use(merchantAuth);

adminRouter.post('/products', async (req: Request, res: Response) => {
  const { name, description, priceUsdc, imageUrl, stock } = req.body as {
    name: string;
    description?: string;
    priceUsdc: number;
    imageUrl?: string;
    stock?: number;
  };

  if (!name || priceUsdc == null) {
    res.status(400).json({ error: 'name and priceUsdc are required' });
    return;
  }

  const product = await db.product.create({
    data: { name, description, priceUsdc, imageUrl, stock: stock ?? -1 },
  });
  res.status(201).json(product);
});

adminRouter.post('/setup', async (_req: Request, res: Response) => {
  const existing = await db.merchantConfig.findUnique({ where: { id: MERCHANT_CONFIG_ID } });

  let muralAccountId = existing?.muralAccountId ?? '';
  let walletAddress = existing?.walletAddress ?? '';
  let counterpartyId = existing?.counterpartyId ?? '';
  let payoutMethodId = existing?.payoutMethodId ?? '';
  let webhookId = existing?.webhookId ?? '';
  let webhookPublicKey = existing?.webhookPublicKey ?? '';

  const steps: string[] = [];

  if (!muralAccountId) {
    const account = await mural.createAccount('Marketplace Account', 'USDC receiving account');
    muralAccountId = account.id;
    walletAddress = account.accountDetails?.walletDetails.walletAddress ?? '';
    steps.push('Created Mural account');
  }

  if (!counterpartyId) {
    const cp = await mural.createCounterparty({
      type: 'business',
      name: 'Mural Merchant CO',
      email: 'merchant@example.com',
      physicalAddress: {
        address1: 'Carrera 7 # 71-21',
        country: 'CO',
        subDivision: 'DC',
        city: 'Bogota',
        postalCode: '110231',
      },
    });
    counterpartyId = cp.id;
    steps.push('Created counterparty');
  }

  if (!payoutMethodId && counterpartyId) {
    const pm = await mural.createCopPayoutMethod(counterpartyId, {
      bankName: 'Bancolombia',
      bankAccountOwner: 'Mural Merchant',
      phoneNumber: '+573001234567',
      accountType: 'CHECKING',
      bankAccountNumber: '19836529841',
      documentNumber: '890903938',
      documentType: 'NATIONAL_ID',
    });
    payoutMethodId = pm.id;
    steps.push('Created COP payout method');
  }

  if (!webhookId && config.webhookPublicUrl && !config.webhookPublicUrl.includes('your-app')) {
    const wh = await mural.createWebhook(
      `${config.webhookPublicUrl}/webhooks/mural`,
      [WEBHOOK_CATEGORIES.BALANCE_ACTIVITY, WEBHOOK_CATEGORIES.PAYOUT_REQUEST],
    );
    webhookId = wh.id;
    webhookPublicKey = wh.publicKey;
    await mural.activateWebhook(webhookId);
    steps.push('Registered and activated webhook');
  }

  await db.merchantConfig.upsert({
    where: { id: MERCHANT_CONFIG_ID },
    create: { id: MERCHANT_CONFIG_ID, muralAccountId, walletAddress, counterpartyId, payoutMethodId, webhookId: webhookId || null, webhookPublicKey: webhookPublicKey || null },
    update: { muralAccountId, walletAddress, counterpartyId, payoutMethodId, webhookId: webhookId || null, webhookPublicKey: webhookPublicKey || null },
  });

  res.json({
    message: steps.length ? 'Setup complete' : 'Already configured',
    steps,
    config: { muralAccountId, walletAddress, counterpartyId, payoutMethodId, webhookId },
  });
});

adminRouter.get('/config', async (_req: Request, res: Response) => {
  const cfg = await db.merchantConfig.findUnique({ where: { id: MERCHANT_CONFIG_ID } });
  if (!cfg) {
    res.status(404).json({ error: 'Not configured. POST /admin/setup to initialize.' });
    return;
  }
  res.json({
    muralAccountId: cfg.muralAccountId,
    walletAddress: cfg.walletAddress,
    counterpartyId: cfg.counterpartyId,
    payoutMethodId: cfg.payoutMethodId,
    webhookId: cfg.webhookId,
    updatedAt: cfg.updatedAt,
  });
});
