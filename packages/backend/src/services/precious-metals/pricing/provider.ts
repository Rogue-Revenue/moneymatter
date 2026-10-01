import type { PreciousMetal } from '@bt/shared/types/precious-metals';
import { Money } from '@common/types/money';
import axios from 'axios';
import { z } from 'zod';

export type PricedMetal = PreciousMetal;

export interface MetalSpotQuote {
  metal: PricedMetal;
  currencyCode: 'USD';
  pricePerTroyOz: Money;
  asOf: Date;
  retrievedAt: Date;
  source: string;
}

const METAL_SYMBOLS: Record<PricedMetal, string> = { gold: 'XAU', silver: 'XAG', platinum: 'XPT' };
const INVALID_QUOTE = 'Invalid precious metal price response';
const PROVIDER_UNAVAILABLE = 'Precious metal price provider unavailable';

export type MetalProviderConfig =
  | { name: 'gold-api.com'; minRequestIntervalMs: number }
  | { name: 'goldapi'; apiKey: string; minRequestIntervalMs: number };

const keylessQuoteSchema = z.object({
  symbol: z.string(),
  currency: z.literal('USD'),
  price: z.number().positive(),
  updatedAt: z.iso.datetime({ offset: true }),
});

const selectedProviderName = (_: Record<string, never>): 'gold-api.com' | 'goldapi' | 'none' => {
  switch (process.env.PRECIOUS_METALS_PRICE_PROVIDER?.trim() || 'gold-api') {
    case 'gold-api':
      return 'gold-api.com';
    case 'goldapi':
      return 'goldapi';
    default:
      return 'none';
  }
};

export const getMetalProviderConfig = (_: Record<string, never>): MetalProviderConfig | null => {
  if (process.env.OFFLINE_MODE === 'true') return null;
  const name = selectedProviderName({});
  if (name === 'gold-api.com') return { name, minRequestIntervalMs: 1100 };
  const apiKey = process.env.GOLDAPI_API_KEY?.trim();
  if (name === 'goldapi' && apiKey) return { name, apiKey, minRequestIntervalMs: 0 };
  return null;
};

const fetchKeylessQuote = async ({ metal }: { metal: PricedMetal }): Promise<MetalSpotQuote> => {
  try {
    const response = await axios.get<unknown>(`https://api.gold-api.com/price/${METAL_SYMBOLS[metal]}/USD`, {
      headers: { Accept: 'application/json' },
      timeout: 8000,
      maxRedirects: 0,
    });
    const data = keylessQuoteSchema.parse(response.data);
    const asOf = new Date(data.updatedAt);
    const retrievedAt = new Date(Date.now());
    if (data.symbol !== METAL_SYMBOLS[metal] || asOf.getTime() > retrievedAt.getTime()) {
      throw new Error(INVALID_QUOTE);
    }
    return {
      metal,
      currencyCode: data.currency,
      pricePerTroyOz: Money.fromDecimal(data.price),
      asOf,
      retrievedAt,
      source: 'gold-api.com',
    };
  } catch {
    throw new Error(PROVIDER_UNAVAILABLE);
  }
};

export const parseGoldApiQuote = ({
  payload,
  metal,
  retrievedAt,
}: {
  payload: unknown;
  metal: PricedMetal;
  retrievedAt: Date;
}): MetalSpotQuote => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error(INVALID_QUOTE);
  const data = payload as Record<string, unknown>;
  if (data.metal !== METAL_SYMBOLS[metal] || data.currency !== 'USD') throw new Error(INVALID_QUOTE);
  if (!['number', 'string'].includes(typeof data.price) || !['number', 'string'].includes(typeof data.timestamp)) {
    throw new Error(INVALID_QUOTE);
  }

  const price = Number(data.price);
  const timestamp = Number(data.timestamp);
  const asOf = new Date(timestamp * 1000);
  if (
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isSafeInteger(timestamp) ||
    timestamp <= 0 ||
    !Number.isFinite(asOf.getTime()) ||
    !Number.isFinite(retrievedAt.getTime()) ||
    asOf.getTime() > retrievedAt.getTime()
  ) {
    throw new Error(INVALID_QUOTE);
  }

  return {
    metal,
    currencyCode: 'USD',
    pricePerTroyOz: Money.fromDecimal(data.price as number | string),
    asOf,
    retrievedAt,
    source: 'goldapi',
  };
};

export const fetchGoldApiQuote = async ({
  metal,
  apiKey,
}: {
  metal: PricedMetal;
  apiKey: string;
}): Promise<MetalSpotQuote> => {
  if (!apiKey.trim()) throw new Error(PROVIDER_UNAVAILABLE);
  try {
    const response = await axios.get<unknown>(`https://www.goldapi.io/api/${METAL_SYMBOLS[metal]}/USD`, {
      headers: { 'x-access-token': apiKey, Accept: 'application/json' },
      timeout: 8000,
      maxRedirects: 0,
    });
    return parseGoldApiQuote({ payload: response.data, metal, retrievedAt: new Date(Date.now()) });
  } catch {
    // Axios errors retain request headers, including the provider credential.
    throw new Error(PROVIDER_UNAVAILABLE);
  }
};

export const getMetalProviderInfo = (
  _: Record<string, never>,
): {
  name: string;
  configured: boolean;
  refreshHours: number;
} => ({ name: selectedProviderName({}), configured: getMetalProviderConfig({}) !== null, refreshHours: 24 });

export const fetchMetalQuote = ({
  metal,
  provider,
}: {
  metal: PricedMetal;
  provider: MetalProviderConfig;
}): Promise<MetalSpotQuote> =>
  provider.name === 'gold-api.com'
    ? fetchKeylessQuote({ metal })
    : fetchGoldApiQuote({ metal, apiKey: provider.apiKey });
