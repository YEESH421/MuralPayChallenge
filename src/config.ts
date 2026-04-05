import dotenv from 'dotenv';
dotenv.config();

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: required('DATABASE_URL'),
  mural: {
    apiKey: required('MURAL_API_KEY'),
    transferApiKey: required('MURAL_TRANSFER_API_KEY'),
    baseUrl: process.env.MURAL_BASE_URL || 'https://api-staging.muralpay.com',
  },
  merchantApiSecret: required('MERCHANT_API_SECRET'),
  webhookPublicUrl: process.env.WEBHOOK_PUBLIC_URL || '',
  orderExpiryHours: 24,
};

export const MERCHANT_CONFIG_ID = 'singleton';

export const WEBHOOK_CATEGORIES = {
  BALANCE_ACTIVITY: 'MURAL_ACCOUNT_BALANCE_ACTIVITY',
  PAYOUT_REQUEST: 'PAYOUT_REQUEST',
} as const;
