import axios, { AxiosInstance } from 'axios';
import { config } from '../config';

// ── Types ──────────────────────────────────────────────────────────────────

export interface MuralAccount {
  id: string;
  name: string;
  status: 'INITIALIZING' | 'ACTIVE';
  isApiEnabled: boolean;
  destinationToken: { symbol: string; blockchain: string };
  accountDetails?: {
    walletDetails: { walletAddress: string; blockchain: string };
    balances: Array<{ tokenAmount: number; tokenSymbol: string }>;
    balancesV2: Array<{ type: string; currencySymbol: string; exponent: number; value: string; blockchain?: string }>;
    payinMethods: unknown[];
  };
}

export interface MuralTransaction {
  id: string;
  hash: string;
  transactionExecutionDate: string;
  amount: { tokenAmount: number; tokenSymbol: string };
  accountId: string;
  counterpartyInfo: { type: string; name?: string };
  transactionDetails: {
    type: string;
    recipientWalletAddress?: string;
    details?: {
      type: string;
      senderAddress?: string;
      blockchain?: string;
    };
  };
}

export interface MuralCounterparty {
  type: 'individual' | 'business';
  id: string;
  createdAt: string;
  updatedAt: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  email: string;
  physicalAddress: {
    address1: string;
    country: string;
    state: string;
    city: string;
    zip: string;
  };
}

export interface MuralPayoutMethod {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface MuralWebhook {
  id: string;
  url: string;
  publicKey: string;
  categories: string[];
  status: 'DISABLED' | 'ACTIVE';
}

export type PayoutStatus =
  | 'AWAITING_EXECUTION'
  | 'CANCELED'
  | 'PENDING'
  | 'EXECUTED'
  | 'FAILED';

export interface MuralPayoutRequest {
  id: string;
  createdAt: string;
  updatedAt: string;
  sourceAccountId: string;
  status: PayoutStatus;
  memo?: string;
  payouts: Array<{
    id: string;
    amount: { tokenAmount: number; tokenSymbol: string };
    details: {
      type: string;
      fiatAndRailCode?: string;
      fiatPayoutStatus?: { type: string; completedAt?: string; initiatedAt?: string };
      fiatAmount?: { fiatAmount: number; fiatCurrencyCode: string };
      exchangeRate?: number;
      feeTotal?: { tokenAmount: number; tokenSymbol: string };
    };
    recipientInfo: unknown;
  }>;
}

// ── Client ─────────────────────────────────────────────────────────────────

function createClient(): AxiosInstance {
  return axios.create({
    baseURL: config.mural.baseUrl,
    headers: {
      Authorization: `Bearer ${config.mural.apiKey}`,
      'Content-Type': 'application/json',
    },
  });
}

const client = createClient();

// ── Accounts ───────────────────────────────────────────────────────────────

export async function getAccounts(): Promise<MuralAccount[]> {
  const res = await client.get<MuralAccount[]>('/api/accounts');
  return res.data;
}

export async function createAccount(name: string, description: string): Promise<MuralAccount> {
  const res = await client.post<MuralAccount>(
    '/api/accounts',
    { name, description, destinationToken: { symbol: 'USDC', blockchain: 'POLYGON' } },
    { headers: { 'transfer-api-key': config.mural.transferApiKey } },
  );
  return res.data;
}

// ── Transactions ────────────────────────────────────────────────────────────

export async function searchTransactions(
  accountId: string,
  limit = 50,
  nextId?: string,
): Promise<{ total: number; results: MuralTransaction[]; nextId?: string }> {
  const params: Record<string, unknown> = { limit };
  if (nextId) params.nextId = nextId;
  const res = await client.post(
    `/api/transactions/search/account/${accountId}`,
    {},
    { params },
  );
  return res.data;
}

// ── Counterparties ──────────────────────────────────────────────────────────

export async function createCounterparty(data: {
  type: 'individual' | 'business';
  firstName?: string;
  lastName?: string;
  name?: string;
  email: string;
  physicalAddress: {
    address1: string;
    country: string;
    subDivision: string;
    city: string;
    postalCode: string;
  };
}): Promise<MuralCounterparty> {
  const res = await client.post<MuralCounterparty>('/api/counterparties', {
    counterparty: data,
  });
  return res.data;
}

// ── Payout Methods ──────────────────────────────────────────────────────────

export async function createCopPayoutMethod(
  counterpartyId: string,
  details: {
    alias: string;
    bankId: string;
    phoneNumber: string;
    accountType: 'CHECKING' | 'SAVINGS';
    bankAccountNumber: string;
    documentNumber: string;
    documentType: 'NATIONAL_ID' | 'RUC_NIT' | 'PASSPORT' | 'RESIDENT_ID';
  },
): Promise<MuralPayoutMethod> {
  const res = await client.post<MuralPayoutMethod>(
    `/api/counterparties/${counterpartyId}/payout-methods`,
    {
      alias: details.alias,
      payoutMethod: {
        type: 'cop',
        details: {
          type: 'copDomestic',
          symbol: 'COP',
          bankId: details.bankId,
          phoneNumber: details.phoneNumber,
          accountType: details.accountType,
          bankAccountNumber: details.bankAccountNumber,
          documentNumber: details.documentNumber,
          documentType: details.documentType,
        },
      },
    },
  );
  return res.data;
}

export async function searchCounterparties(): Promise<MuralCounterparty[]> {
  const res = await client.post<{ total: number; results: MuralCounterparty[] }>(
    '/api/counterparties/search',
    {},
  );
  return res.data.results;
}

export async function searchPayoutMethods(counterpartyId: string): Promise<MuralPayoutMethod[]> {
  const res = await client.post<{ total: number; results: MuralPayoutMethod[] }>(
    `/api/counterparties/${counterpartyId}/payout-methods/search`,
    {},
  );
  return res.data.results;
}

// ── Webhooks ────────────────────────────────────────────────────────────────

export async function createWebhook(
  url: string,
  categories: string[],
): Promise<MuralWebhook> {
  const res = await client.post<MuralWebhook>('/api/webhooks', { url, categories });
  return res.data;
}

export async function activateWebhook(webhookId: string): Promise<void> {
  await client.patch(`/api/webhooks/${webhookId}/status`, { status: 'ACTIVE' });
}

export async function listWebhooks(): Promise<MuralWebhook[]> {
  const res = await client.get<MuralWebhook[]>('/api/webhooks');
  return res.data;
}

// ── Payouts ─────────────────────────────────────────────────────────────────

export async function createPayoutRequest(body: {
  sourceAccountId: string;
  memo?: string;
  payouts: Array<{
    amount: { tokenAmount: number; tokenSymbol: string };
    payoutDetails: {
      type: 'counterpartyPayoutMethod';
      payoutMethodId: string;
    };
    recipientInfo: {
      type: 'counterpartyInfo';
      counterpartyId: string;
    };
    supportingDetails?: {
      payoutPurpose: string;
    };
  }>;
}): Promise<MuralPayoutRequest> {
  const res = await client.post<MuralPayoutRequest>('/api/payouts/payout', body);
  return res.data;
}

export async function executePayoutRequest(
  payoutRequestId: string,
  exchangeRateToleranceMode: 'FLEXIBLE' | 'STRICT' = 'FLEXIBLE',
): Promise<MuralPayoutRequest> {
  const res = await client.post<MuralPayoutRequest>(
    `/api/payouts/payout/${payoutRequestId}/execute`,
    { exchangeRateToleranceMode },
    { headers: { 'transfer-api-key': config.mural.transferApiKey } },
  );
  return res.data;
}

export async function getPayoutRequest(id: string): Promise<MuralPayoutRequest> {
  const res = await client.get<MuralPayoutRequest>(`/api/payouts/payout/${id}`);
  return res.data;
}
