import { afterEach, describe, expect, it, jest } from '@jest/globals';
import axios from 'axios';

import {
  fetchGoldApiQuote,
  fetchMetalQuote,
  getMetalProviderConfig,
  getMetalProviderInfo,
  parseGoldApiQuote,
} from './provider';

const retrievedAt = new Date('2026-10-01T01:00:00.000Z');
const payload = { timestamp: 1790812800, metal: 'XAU', currency: 'USD', price: 2000 };

const restoreEnv = ({ key, value }: { key: string; value: string | undefined }) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

const selectKeylessProvider = () => {
  delete process.env.PRECIOUS_METALS_PRICE_PROVIDER;
  delete process.env.GOLDAPI_API_KEY;
  delete process.env.OFFLINE_MODE;
  return getMetalProviderConfig({})!;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GoldAPI quote parsing', () => {
  it('preserves the upstream quote time and USD per fine troy ounce price', () => {
    const quote = parseGoldApiQuote({ payload, metal: 'gold', retrievedAt });
    expect(quote).toMatchObject({
      metal: 'gold',
      currencyCode: 'USD',
      asOf: new Date('2026-10-01T00:00:00.000Z'),
      retrievedAt,
      source: 'goldapi',
    });
    expect(quote.pricePerTroyOz.toNumber()).toBe(2000);
  });

  it('supports silver without converting the quote to grams', () => {
    const quote = parseGoldApiQuote({ payload: { ...payload, metal: 'XAG', price: 25 }, metal: 'silver', retrievedAt });
    expect(quote.metal).toBe('silver');
    expect(quote.pricePerTroyOz.toNumber()).toBe(25);
  });

  it('normalizes platinum from the optional GoldAPI.io adapter', async () => {
    const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { ...payload, metal: 'XPT', price: 1000 } });
    jest.spyOn(Date, 'now').mockReturnValue(retrievedAt.getTime());
    const quote = await fetchGoldApiQuote({ metal: 'platinum', apiKey: 'synthetic-api-key' });
    expect(quote).toMatchObject({ metal: 'platinum', source: 'goldapi', currencyCode: 'USD' });
    expect(quote.pricePerTroyOz.toNumber()).toBe(1000);
    expect(get).toHaveBeenCalledWith('https://www.goldapi.io/api/XPT/USD', expect.any(Object));
  });

  it.each([
    null,
    [],
    { ...payload, metal: 'XAG' },
    { ...payload, currency: 'EUR' },
    { ...payload, price: undefined, ask: 2001 },
    { ...payload, price: 0 },
    { ...payload, price: -1 },
    { ...payload, price: Number.POSITIVE_INFINITY },
    { ...payload, price: 'not-a-price' },
    { ...payload, timestamp: undefined },
    { ...payload, timestamp: 0 },
    { ...payload, timestamp: 1790816401 },
    { error: 'quota exceeded' },
  ])('rejects malformed or mismatched quote %#', (invalidPayload) => {
    expect(() => parseGoldApiQuote({ payload: invalidPayload, metal: 'gold', retrievedAt })).toThrow();
  });
});

describe('GoldAPI transport', () => {
  it('fetches from the fixed provider URL and returns a normalized quote', async () => {
    const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: payload });
    jest.spyOn(Date, 'now').mockReturnValue(retrievedAt.getTime());

    const result = await fetchGoldApiQuote({ metal: 'gold', apiKey: 'synthetic-api-key' });

    expect(result.pricePerTroyOz.toNumber()).toBe(2000);
    expect(get).toHaveBeenCalledWith('https://www.goldapi.io/api/XAU/USD', {
      headers: { 'x-access-token': 'synthetic-api-key', Accept: 'application/json' },
      timeout: 8000,
      maxRedirects: 0,
    });
  });

  it('returns a safe error without leaking request headers or upstream error bodies', async () => {
    jest.spyOn(axios, 'get').mockRejectedValue(new Error('x-access-token: synthetic-api-key'));
    await expect(fetchGoldApiQuote({ metal: 'silver', apiKey: 'synthetic-api-key' })).rejects.toThrow(
      'Precious metal price provider unavailable',
    );
  });

  it('makes no request when the server key is missing', async () => {
    const get = jest.spyOn(axios, 'get');
    await expect(fetchGoldApiQuote({ metal: 'gold', apiKey: '' })).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });

  it('reports optional configuration without exposing the credential', () => {
    const key = process.env.GOLDAPI_API_KEY;
    const selected = process.env.PRECIOUS_METALS_PRICE_PROVIDER;
    const offline = process.env.OFFLINE_MODE;
    try {
      process.env.PRECIOUS_METALS_PRICE_PROVIDER = 'goldapi';
      delete process.env.OFFLINE_MODE;
      delete process.env.GOLDAPI_API_KEY;
      expect(getMetalProviderInfo({})).toEqual({ name: 'goldapi', configured: false, refreshHours: 24 });
      process.env.GOLDAPI_API_KEY = 'synthetic-api-key';
      expect(getMetalProviderInfo({})).toEqual({ name: 'goldapi', configured: true, refreshHours: 24 });
    } finally {
      if (selected === undefined) delete process.env.PRECIOUS_METALS_PRICE_PROVIDER;
      else process.env.PRECIOUS_METALS_PRICE_PROVIDER = selected;
      if (offline === undefined) delete process.env.OFFLINE_MODE;
      else process.env.OFFLINE_MODE = offline;
      if (key === undefined) delete process.env.GOLDAPI_API_KEY;
      else process.env.GOLDAPI_API_KEY = key;
    }
  });
});

describe('Gold-API.com keyless provider', () => {
  const originalProvider = process.env.PRECIOUS_METALS_PRICE_PROVIDER;
  const originalKey = process.env.GOLDAPI_API_KEY;
  const originalOffline = process.env.OFFLINE_MODE;
  const keylessPayload = { symbol: 'XAU', currency: 'USD', price: 2000, updatedAt: '2026-10-01T00:00:00Z' };

  afterEach(() => {
    restoreEnv({ key: 'PRECIOUS_METALS_PRICE_PROVIDER', value: originalProvider });
    restoreEnv({ key: 'GOLDAPI_API_KEY', value: originalKey });
    restoreEnv({ key: 'OFFLINE_MODE', value: originalOffline });
  });

  it('defaults to enabled keyless pricing without exposing credentials', () => {
    selectKeylessProvider();
    expect(getMetalProviderInfo({})).toEqual({ name: 'gold-api.com', configured: true, refreshHours: 24 });
  });

  it.each([
    { metal: 'gold' as const, symbol: 'XAU', price: 2000 },
    { metal: 'silver' as const, symbol: 'XAG', price: 25 },
    { metal: 'platinum' as const, symbol: 'XPT', price: 1000 },
  ])('normalizes $metal USD quotes while retaining the actual update timestamp', async ({ metal, symbol, price }) => {
    const provider = selectKeylessProvider();
    const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: { ...keylessPayload, symbol, price } });
    jest.spyOn(Date, 'now').mockReturnValue(retrievedAt.getTime());
    const quote = await fetchMetalQuote({ metal, provider });
    expect(quote).toMatchObject({
      metal,
      currencyCode: 'USD',
      source: 'gold-api.com',
      asOf: new Date(keylessPayload.updatedAt),
      retrievedAt,
    });
    expect(quote.pricePerTroyOz.toNumber()).toBe(price);
    expect(get).toHaveBeenCalledWith(`https://api.gold-api.com/price/${symbol}/USD`, {
      headers: { Accept: 'application/json' },
      timeout: 8000,
      maxRedirects: 0,
    });
  });

  it.each([
    { symbol: 'XAG' },
    { currency: 'EUR' },
    { currency: undefined },
    { price: 0 },
    { price: -1 },
    { price: true },
    { price: 'NaN' },
    { price: Infinity },
    { updatedAt: undefined },
    { updatedAt: 'not-a-date' },
    { updatedAt: '2026-02-30T00:00:00Z' },
    { updatedAt: '2026-10-01T00:00:00' },
    { updatedAt: '2026-10-01T01:00:01Z' },
  ])('rejects a malformed or mismatched current quote %#', async (overrides) => {
    const provider = selectKeylessProvider();
    jest.spyOn(axios, 'get').mockResolvedValue({ data: { ...keylessPayload, ...overrides } });
    jest.spyOn(Date, 'now').mockReturnValue(retrievedAt.getTime());
    await expect(fetchMetalQuote({ metal: 'gold', provider })).rejects.toThrow(
      'Precious metal price provider unavailable',
    );
  });

  it('keeps explicit manual and offline modes free of automatic providers', () => {
    selectKeylessProvider();
    process.env.PRECIOUS_METALS_PRICE_PROVIDER = 'none';
    expect(getMetalProviderConfig({})).toBeNull();
    expect(getMetalProviderInfo({}).configured).toBe(false);
    delete process.env.PRECIOUS_METALS_PRICE_PROVIDER;
    process.env.OFFLINE_MODE = 'true';
    expect(getMetalProviderConfig({})).toBeNull();
    expect(getMetalProviderInfo({}).configured).toBe(false);
  });

  it('fails closed on an unknown provider setting', () => {
    selectKeylessProvider();
    process.env.PRECIOUS_METALS_PRICE_PROVIDER = 'https://untrusted.invalid';
    expect(getMetalProviderConfig({})).toBeNull();
    expect(getMetalProviderInfo({}).configured).toBe(false);
  });

  it('uses the explicitly selected legacy adapter and server credential', async () => {
    selectKeylessProvider();
    process.env.PRECIOUS_METALS_PRICE_PROVIDER = 'goldapi';
    process.env.GOLDAPI_API_KEY = 'synthetic-api-key';
    const get = jest.spyOn(axios, 'get').mockResolvedValue({ data: payload });
    jest.spyOn(Date, 'now').mockReturnValue(retrievedAt.getTime());
    const quote = await fetchMetalQuote({ metal: 'gold', provider: getMetalProviderConfig({})! });
    expect(quote.source).toBe('goldapi');
    expect(get).toHaveBeenCalledWith(
      'https://www.goldapi.io/api/XAU/USD',
      expect.objectContaining({
        headers: { 'x-access-token': 'synthetic-api-key', Accept: 'application/json' },
      }),
    );
  });
});
