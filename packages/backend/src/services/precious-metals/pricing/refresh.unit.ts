import { Money } from '@common/types/money';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import PreciousMetalQuotes from '@models/precious-metals/quotes.model';
import { redisClient } from '@root/redis-client';

import { fetchMetalQuote, type MetalSpotQuote } from './provider';
import { refreshMetalPrices } from './refresh';

jest.mock('@models/precious-metals/quotes.model', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), create: jest.fn() },
}));
jest.mock('@root/redis-client', () => ({ redisClient: { set: jest.fn(), eval: jest.fn() } }));
jest.mock('@js/utils/logger', () => ({ logger: { warn: jest.fn() } }));
jest.mock('@services/common/with-transaction', () => ({ withTransaction: (fn: unknown) => fn }));
jest.mock('./provider', () => ({
  ...jest.requireActual<typeof import('./provider')>('./provider'),
  fetchMetalQuote: jest.fn(),
}));

const cache = redisClient as unknown as {
  set: jest.Mock<(key: string, value: string, ...options: (string | number)[]) => Promise<string | null>>;
  eval: jest.Mock<(script: string, count: number, key: string, token: string) => Promise<number>>;
};
const keyBefore = process.env.GOLDAPI_API_KEY;
const offlineBefore = process.env.OFFLINE_MODE;
const providerBefore = process.env.PRECIOUS_METALS_PRICE_PROVIDER;
const records = new Map<string, MetalSpotQuote>();
const keys = new Map<string, { value: string; expiresAt: number }>();
const now = new Date('2026-10-01T01:00:00.000Z');
const prices = { gold: 2000, silver: 25, platinum: 1000 };

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now });
  process.env.GOLDAPI_API_KEY = 'synthetic-api-key';
  process.env.PRECIOUS_METALS_PRICE_PROVIDER = 'goldapi';
  delete process.env.OFFLINE_MODE;
  records.clear();
  keys.clear();

  cache.set.mockImplementation(async (key, value, ...options) => {
    const current = keys.get(key);
    if (options.includes('NX') && current && current.expiresAt > Date.now()) return null;
    const seconds = options.indexOf('EX');
    const milliseconds = options.indexOf('PX');
    const ttl = seconds >= 0 ? Number(options[seconds + 1]) * 1000 : Number(options[milliseconds + 1]);
    keys.set(key, { value, expiresAt: Date.now() + ttl });
    return 'OK';
  });
  cache.eval.mockImplementation(async (_script, _count, key, token) => {
    if (keys.get(key)?.value !== token) return 0;
    keys.delete(key);
    return 1;
  });
  jest.mocked(PreciousMetalQuotes.findOne).mockImplementation(async (options) => {
    if (!options?.where) throw new Error('Quote lookup requires a metal filter');
    const { metal, source } = options.where as { metal: string; source: string };
    return (records.get(`${source}:${metal}`) ?? null) as never;
  });
  jest.mocked(PreciousMetalQuotes.create).mockImplementation(async (values) => {
    const quote = values as unknown as MetalSpotQuote;
    records.set(`${quote.source}:${quote.metal}`, quote);
    return quote as never;
  });
  jest.mocked(fetchMetalQuote).mockImplementation(async ({ metal, provider }) => ({
    metal,
    currencyCode: 'USD',
    pricePerTroyOz: Money.fromDecimal(prices[metal]),
    asOf: new Date('2026-10-01T00:00:00.000Z'),
    retrievedAt: new Date(Date.now()),
    source: provider.name,
  }));
});

afterEach(() => {
  jest.useRealTimers();
  if (keyBefore === undefined) delete process.env.GOLDAPI_API_KEY;
  else process.env.GOLDAPI_API_KEY = keyBefore;
  if (providerBefore === undefined) delete process.env.PRECIOUS_METALS_PRICE_PROVIDER;
  else process.env.PRECIOUS_METALS_PRICE_PROVIDER = providerBefore;
  if (offlineBefore === undefined) delete process.env.OFFLINE_MODE;
  else process.env.OFFLINE_MODE = offlineBefore;
});

describe('shared precious metal quote refresh', () => {
  it('disables the optional GoldAPI.io provider when its key is missing', async () => {
    delete process.env.GOLDAPI_API_KEY;
    expect(await refreshMetalPrices({})).toEqual({ configured: false, refreshed: false });
    expect(fetchMetalQuote).not.toHaveBeenCalled();
  });

  it('respects offline mode even with a configured key', async () => {
    process.env.OFFLINE_MODE = 'true';
    expect(await refreshMetalPrices({})).toEqual({ configured: false, refreshed: false });
    expect(fetchMetalQuote).not.toHaveBeenCalled();
  });

  it('persists all three global metal quotes once and reuses the daily cache', async () => {
    expect(await refreshMetalPrices({})).toEqual({ configured: true, refreshed: true });
    expect(await refreshMetalPrices({})).toEqual({ configured: true, refreshed: false });
    expect(records.get('goldapi:gold')?.pricePerTroyOz.toNumber()).toBe(2000);
    expect(records.get('goldapi:silver')?.pricePerTroyOz.toNumber()).toBe(25);
    expect(records.get('goldapi:platinum')?.pricePerTroyOz.toNumber()).toBe(1000);
    expect(PreciousMetalQuotes.create).toHaveBeenCalledWith(expect.objectContaining({ userId: null, holdingId: null }));
    expect(fetchMetalQuote).toHaveBeenCalledTimes(3);
  });

  it('refetches after 24 hours using retrieval time even when the market timestamp is old', async () => {
    await refreshMetalPrices({});
    jest.setSystemTime(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    expect(await refreshMetalPrices({})).toEqual({ configured: true, refreshed: true });
    expect(fetchMetalQuote).toHaveBeenCalledTimes(6);
  });

  it('allows only one concurrent refresh batch across workers', async () => {
    await Promise.all([refreshMetalPrices({}), refreshMetalPrices({}), refreshMetalPrices({})]);
    expect(records.size).toBe(3);
    expect(fetchMetalQuote).toHaveBeenCalledTimes(3);
  });

  it('saves silver and platinum when gold fails and backs off gold for one hour', async () => {
    jest.mocked(fetchMetalQuote).mockRejectedValueOnce(new Error('synthetic provider outage'));
    expect(await refreshMetalPrices({})).toEqual({ configured: true, refreshed: true });
    expect(records.has('goldapi:gold')).toBe(false);
    expect(records.has('goldapi:silver')).toBe(true);
    expect(records.has('goldapi:platinum')).toBe(true);
    expect(await refreshMetalPrices({})).toEqual({ configured: true, refreshed: false });
    expect(fetchMetalQuote).toHaveBeenCalledTimes(3);
    jest.setSystemTime(new Date(now.getTime() + 60 * 60 * 1000));
    expect(await refreshMetalPrices({})).toEqual({ configured: true, refreshed: true });
    expect(fetchMetalQuote).toHaveBeenCalledTimes(4);
  });

  it('preserves the last good quote when the provider fails', async () => {
    await refreshMetalPrices({});
    const previous = records.get('goldapi:gold');
    const platinum = records.get('goldapi:platinum');
    expect(platinum).toBeDefined();
    jest.setSystemTime(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    jest.mocked(fetchMetalQuote).mockRejectedValue(new Error('synthetic provider outage'));
    expect(await refreshMetalPrices({})).toEqual({ configured: true, refreshed: false });
    expect(records.get('goldapi:gold')).toBe(previous);
    expect(records.get('goldapi:platinum')).toBe(platinum);
  });

  it('fails closed when the distributed lock is unavailable', async () => {
    cache.set.mockRejectedValueOnce(new Error('synthetic Redis outage'));
    expect(await refreshMetalPrices({})).toEqual({ configured: true, refreshed: false });
    expect(fetchMetalQuote).not.toHaveBeenCalled();
  });

  it('does not delete a lock that another worker owns after lease expiry', async () => {
    jest.mocked(fetchMetalQuote).mockImplementation(async ({ metal }) => {
      const lockEntry = [...keys.entries()].find(([key]) => key.endsWith(':lock'));
      if (lockEntry) keys.set(lockEntry[0], { value: 'other-worker', expiresAt: Date.now() + 30_000 });
      return {
        metal,
        currencyCode: 'USD',
        pricePerTroyOz: Money.fromDecimal(25),
        asOf: now,
        retrievedAt: now,
        source: 'goldapi',
      };
    });
    await refreshMetalPrices({});
    expect([...keys.values()].some(({ value }) => value === 'other-worker')).toBe(true);
    expect(cache.eval.mock.calls[0]?.[0]).toContain("redis.call('get', KEYS[1]) == ARGV[1]");
  });
});

describe('keyless price refresh pacing', () => {
  it('spaces requests across batches when the metal cache expiries differ', async () => {
    delete process.env.PRECIOUS_METALS_PRICE_PROVIDER;
    records.set('gold-api.com:gold', {
      metal: 'gold',
      currencyCode: 'USD',
      pricePerTroyOz: Money.fromDecimal(2000),
      asOf: now,
      retrievedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000 + 500),
      source: 'gold-api.com',
    });
    records.set('gold-api.com:platinum', {
      metal: 'platinum',
      currencyCode: 'USD',
      pricePerTroyOz: Money.fromDecimal(1000),
      asOf: now,
      retrievedAt: now,
      source: 'gold-api.com',
    });
    await refreshMetalPrices({});
    expect(fetchMetalQuote).toHaveBeenCalledTimes(1);
    expect(fetchMetalQuote).toHaveBeenLastCalledWith(expect.objectContaining({ metal: 'silver' }));

    await jest.advanceTimersByTimeAsync(500);
    const result = refreshMetalPrices({});
    await jest.advanceTimersByTimeAsync(0);
    expect(fetchMetalQuote).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1100);
    expect(await result).toEqual({ configured: true, refreshed: true });
    expect(fetchMetalQuote).toHaveBeenCalledTimes(2);
    expect(fetchMetalQuote).toHaveBeenLastCalledWith(expect.objectContaining({ metal: 'gold' }));
  });

  it('spaces all three metal requests by at least one second and shares cached prices', async () => {
    delete process.env.PRECIOUS_METALS_PRICE_PROVIDER;
    delete process.env.GOLDAPI_API_KEY;
    const result = refreshMetalPrices({});
    await jest.advanceTimersByTimeAsync(0);
    expect(fetchMetalQuote).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1000);
    expect(fetchMetalQuote).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(100);
    expect(fetchMetalQuote).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1000);
    expect(fetchMetalQuote).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(100);
    expect(await result).toEqual({ configured: true, refreshed: true });
    expect(records.get('gold-api.com:gold')?.pricePerTroyOz.toNumber()).toBe(2000);
    expect(records.get('gold-api.com:silver')?.pricePerTroyOz.toNumber()).toBe(25);
    expect(records.get('gold-api.com:platinum')?.pricePerTroyOz.toNumber()).toBe(1000);
    expect(await refreshMetalPrices({})).toEqual({ configured: true, refreshed: false });
    expect(fetchMetalQuote).toHaveBeenCalledTimes(3);
  });

  it('keeps legacy quotes while populating a separate cache for the new provider', async () => {
    await refreshMetalPrices({});
    const legacy = records.get('goldapi:gold');
    delete process.env.PRECIOUS_METALS_PRICE_PROVIDER;
    const result = refreshMetalPrices({});
    await jest.advanceTimersByTimeAsync(2200);
    expect(await result).toEqual({ configured: true, refreshed: true });
    expect(records.get('goldapi:gold')).toBe(legacy);
    expect(records.size).toBe(6);
  });

  it('makes no requests in explicit manual mode even when a legacy credential exists', async () => {
    process.env.PRECIOUS_METALS_PRICE_PROVIDER = 'none';
    expect(await refreshMetalPrices({})).toEqual({ configured: false, refreshed: false });
    expect(fetchMetalQuote).not.toHaveBeenCalled();
  });
});
