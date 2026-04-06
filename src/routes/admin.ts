import { Router, Request, Response } from 'express';
import { pool } from '../db';
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

  const { rows } = await pool.query(
    `INSERT INTO "Product" (id, name, description, "priceUsdc", "imageUrl", stock)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5) RETURNING *`,
    [name, description ?? null, priceUsdc, imageUrl ?? null, stock ?? -1],
  );
  res.status(201).json(rows[0]);
});

adminRouter.post('/setup', async (_req: Request, res: Response) => {
  const { rows: configRows } = await pool.query(
    'SELECT * FROM "MerchantConfig" WHERE id = $1',
    [MERCHANT_CONFIG_ID],
  );
  const existing = configRows[0];

  let muralAccountId: string = existing?.muralAccountId ?? '';
  let walletAddress: string = existing?.walletAddress ?? '';
  let counterpartyId: string = existing?.counterpartyId ?? '';
  let payoutMethodId: string = existing?.payoutMethodId ?? '';
  let webhookId: string = existing?.webhookId ?? '';
  let webhookPublicKey: string = existing?.webhookPublicKey ?? '';

  const steps: string[] = [];

  if (!muralAccountId) {
    const account = await mural.createAccount('Marketplace Account', 'USDC receiving account');
    muralAccountId = account.id;
    walletAddress = account.accountDetails?.walletDetails.walletAddress ?? '';
    if (!walletAddress && account.status === 'INITIALIZING') {
      for (let i = 0; i < 15 && !walletAddress; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const accounts = await mural.getAccounts();
        const a = accounts.find((x) => x.id === muralAccountId);
        walletAddress = a?.accountDetails?.walletDetails.walletAddress ?? '';
      }
    }
    steps.push('Created Mural account');
  } else if (!walletAddress) {
    const accounts = await mural.getAccounts();
    const a = accounts.find((x) => x.id === muralAccountId);
    walletAddress = a?.accountDetails?.walletDetails.walletAddress ?? '';
  }

  if (!counterpartyId) {
    try {
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
    } catch {
      const counterparties = await mural.searchCounterparties();
      const found = counterparties.find((c) => c.email === 'merchant@example.com');
      if (!found) throw new Error('Could not find existing counterparty');
      counterpartyId = found.id;
      steps.push('Found existing counterparty');
    }
  }

  if (!payoutMethodId && counterpartyId) {
    try {
      const pm = await mural.createCopPayoutMethod(counterpartyId, {
        alias: 'Merchant Bancolombia COP',
        bankId: 'bank_cop_022',
        phoneNumber: '+573001234567',
        accountType: 'CHECKING',
        bankAccountNumber: '19836529841',
        documentNumber: '890903938',
        documentType: 'NATIONAL_ID',
      });
      payoutMethodId = pm.id;
      steps.push('Created COP payout method');
    } catch {
      const methods = await mural.searchPayoutMethods(counterpartyId);
      const found = methods[0];
      if (!found) throw new Error('Could not find existing payout method');
      payoutMethodId = found.id;
      steps.push('Found existing payout method');
    }
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

  await pool.query(
    `INSERT INTO "MerchantConfig" (id, "muralAccountId", "walletAddress", "counterpartyId", "payoutMethodId", "webhookId", "webhookPublicKey")
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE SET
       "muralAccountId" = EXCLUDED."muralAccountId",
       "walletAddress" = EXCLUDED."walletAddress",
       "counterpartyId" = EXCLUDED."counterpartyId",
       "payoutMethodId" = EXCLUDED."payoutMethodId",
       "webhookId" = EXCLUDED."webhookId",
       "webhookPublicKey" = EXCLUDED."webhookPublicKey",
       "updatedAt" = NOW()`,
    [
      MERCHANT_CONFIG_ID,
      muralAccountId,
      walletAddress,
      counterpartyId || null,
      payoutMethodId || null,
      webhookId || null,
      webhookPublicKey || null,
    ],
  );

  res.json({
    message: steps.length ? 'Setup complete' : 'Already configured',
    steps,
    config: { muralAccountId, walletAddress, counterpartyId, payoutMethodId, webhookId },
  });
});

adminRouter.get('/config', async (_req: Request, res: Response) => {
  const { rows } = await pool.query(
    'SELECT * FROM "MerchantConfig" WHERE id = $1',
    [MERCHANT_CONFIG_ID],
  );
  const cfg = rows[0];
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
