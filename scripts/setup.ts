/**
 * One-time setup script. Run with: npm run setup
 *
 * Creates:
 *  1. A new API-enabled Mural account (requires Transfer API Key)
 *  2. A Counterparty representing the merchant
 *  3. A COP payout method on that counterparty
 *  4. A webhook for balance + payout events
 *  5. Seeds sample products into the DB
 */

import 'dotenv/config';
import { config, MERCHANT_CONFIG_ID, WEBHOOK_CATEGORIES } from '../src/config';
import { db } from '../src/db';
import * as mural from '../src/services/mural';

const COP_BANK = {
  bankName: 'Bancolombia',
  bankAccountOwner: 'Mural Merchant',
  phoneNumber: '+573001234567',
  accountType: 'CHECKING' as const,
  bankAccountNumber: '19836529841',
  documentNumber: '890903938',
  documentType: 'NATIONAL_ID' as const,
};

const SAMPLE_PRODUCTS = [
  { name: 'Wireless Headphones', description: 'Premium noise-cancelling headphones', priceUsdc: 49.99, stock: 100 },
  { name: 'Mechanical Keyboard', description: 'Compact TKL mechanical keyboard', priceUsdc: 89.99, stock: 50 },
  { name: 'USB-C Hub', description: '7-in-1 USB-C multiport adapter', priceUsdc: 29.99, stock: 200 },
  { name: 'Webcam HD', description: '1080p HD webcam with built-in mic', priceUsdc: 39.99, stock: 75 },
  { name: 'Mouse Pad XL', description: 'Extended gaming mouse pad', priceUsdc: 14.99, stock: -1 },
];

async function main() {
  console.log('🚀 Starting Mural Pay marketplace setup...\n');

  // Check for existing config
  const existing = await db.merchantConfig.findUnique({ where: { id: MERCHANT_CONFIG_ID } });
  if (existing) {
    console.log('✅ MerchantConfig already exists:');
    console.log(`   Account ID:     ${existing.muralAccountId}`);
    console.log(`   Wallet:         ${existing.walletAddress}`);
    console.log(`   Counterparty:   ${existing.counterpartyId ?? 'not set'}`);
    console.log(`   Payout Method:  ${existing.payoutMethodId ?? 'not set'}`);
    console.log(`   Webhook ID:     ${existing.webhookId ?? 'not set'}`);
    console.log('\nRe-running will skip account/counterparty creation.');
  }


  let muralAccountId = existing?.muralAccountId ?? '';
  let walletAddress = existing?.walletAddress ?? '';

  if (!muralAccountId) {
    console.log('📦 Creating Mural API account...');
    const account = await mural.createAccount(
      'Marketplace Account',
      'Main USDC receiving account for the marketplace',
    );
    muralAccountId = account.id;
    walletAddress = account.accountDetails?.walletDetails.walletAddress ?? '';

    if (account.status === 'INITIALIZING') {
      console.log('   Account initializing, waiting up to 30s...');
      for (let i = 0; i < 15; i++) {
        await sleep(2000);
        const accounts = await mural.getAccounts();
        const a = accounts.find((x) => x.id === muralAccountId);
        if (a?.status === 'ACTIVE') {
          walletAddress = a.accountDetails?.walletDetails.walletAddress ?? '';
          break;
        }
      }
    }

    console.log(`   ✅ Account ID:   ${muralAccountId}`);
    console.log(`   ✅ Wallet:       ${walletAddress}`);
  } else {
    console.log(`✅ Using existing account: ${muralAccountId}`);
  }


  let counterpartyId = existing?.counterpartyId ?? '';

  if (!counterpartyId) {
    console.log('\n👤 Creating merchant counterparty...');
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
    console.log(`   ✅ Counterparty ID: ${counterpartyId}`);
  } else {
    console.log(`\n✅ Using existing counterparty: ${counterpartyId}`);
  }


  let payoutMethodId = existing?.payoutMethodId ?? '';

  if (!payoutMethodId) {
    console.log('\n💳 Creating COP payout method...');
    const pm = await mural.createCopPayoutMethod(counterpartyId, COP_BANK);
    payoutMethodId = pm.id;
    console.log(`   ✅ Payout Method ID: ${payoutMethodId}`);
  } else {
    console.log(`\n✅ Using existing payout method: ${payoutMethodId}`);
  }


  let webhookId = existing?.webhookId ?? '';
  let webhookPublicKey = existing?.webhookPublicKey ?? '';

  if (!webhookId) {
    if (!config.webhookPublicUrl || config.webhookPublicUrl.includes('your-app')) {
      console.log('\n⚠️  WEBHOOK_PUBLIC_URL not set in .env — skipping webhook registration.');
      console.log('   Set it to your deployed URL and re-run setup.');
    } else {
      console.log('\n🪝 Registering webhook...');
      const wh = await mural.createWebhook(
        `${config.webhookPublicUrl}/webhooks/mural`,
        [WEBHOOK_CATEGORIES.BALANCE_ACTIVITY, WEBHOOK_CATEGORIES.PAYOUT_REQUEST],
      );
      webhookId = wh.id;
      webhookPublicKey = wh.publicKey;
      await mural.activateWebhook(webhookId);
      console.log(`   ✅ Webhook ID: ${webhookId}`);
    }
  } else {
    console.log(`\n✅ Using existing webhook: ${webhookId}`);
  }


  console.log('\n💾 Saving config to database...');
  await db.merchantConfig.upsert({
    where: { id: MERCHANT_CONFIG_ID },
    create: {
      id: MERCHANT_CONFIG_ID,
      muralAccountId,
      walletAddress,
      counterpartyId,
      payoutMethodId,
      webhookId: webhookId || null,
      webhookPublicKey: webhookPublicKey || null,
    },
    update: {
      muralAccountId,
      walletAddress,
      counterpartyId,
      payoutMethodId,
      webhookId: webhookId || null,
      webhookPublicKey: webhookPublicKey || null,
    },
  });
  console.log('   ✅ Config saved.');


  const productCount = await db.product.count();
  if (productCount === 0) {
    console.log('\n🛍️  Seeding sample products...');
    await db.product.createMany({ data: SAMPLE_PRODUCTS });
    SAMPLE_PRODUCTS.forEach((p) => console.log(`   ✅ ${p.name} — $${p.priceUsdc} USDC`));
  } else {
    console.log(`\n✅ ${productCount} products already seeded.`);
  }

  console.log('\n✨ Setup complete!\n');
  console.log(`Merchant wallet address (customers send USDC here):`);
  console.log(`  ${walletAddress} (Polygon)`);

  await db.$disconnect();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e: unknown) => {
  const detail =
    (e as { response?: { data?: unknown } })?.response?.data ??
    (e instanceof Error ? e.message : String(e));
  console.error('❌ Setup failed:', detail);
  process.exit(1);
});
