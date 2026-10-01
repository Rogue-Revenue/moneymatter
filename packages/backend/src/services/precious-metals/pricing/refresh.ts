import { PRECIOUS_METALS } from '@bt/shared/types/precious-metals';
import { logger } from '@js/utils/logger';
import PreciousMetalQuotes from '@models/precious-metals/quotes.model';
import { redisClient } from '@root/redis-client';
import { withTransaction } from '@services/common/with-transaction';
import { randomUUID } from 'node:crypto';

import {
  fetchMetalQuote,
  getMetalProviderConfig,
  type MetalProviderConfig,
  type MetalSpotQuote,
  type PricedMetal,
} from './provider';

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETRY_INTERVAL_SECONDS = 60 * 60;
const RELEASE_LOCK =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

const saveQuote = withTransaction(async ({ quote }: { quote: MetalSpotQuote }) => {
  await PreciousMetalQuotes.create({ ...quote, userId: null, holdingId: null });
});

const refreshMetal = async ({
  metal,
  provider,
  beforeRequest,
}: {
  metal: PricedMetal;
  provider: MetalProviderConfig;
  beforeRequest: () => Promise<void>;
}): Promise<boolean> => {
  try {
    const latest = await PreciousMetalQuotes.findOne({
      where: { userId: null, holdingId: null, metal, currencyCode: 'USD', source: provider.name },
      order: [['retrievedAt', 'DESC']],
    });
    if (latest && Date.now() - latest.retrievedAt.getTime() < REFRESH_INTERVAL_MS) return false;

    // Reserve the attempt before fetching so failures and expired batch locks cannot create request storms.
    const reserved = await redisClient.set(
      `precious-metals:${provider.name}:attempt:${metal}`,
      '1',
      'EX',
      RETRY_INTERVAL_SECONDS,
      'NX',
    );
    if (reserved !== 'OK') return false;

    await beforeRequest();
    const quote = await fetchMetalQuote({ metal, provider });
    await saveQuote({ quote });
    return true;
  } catch {
    logger.warn(`Precious metal quote refresh unavailable for ${metal}; retaining the last successful quote`);
    return false;
  }
};

export const refreshMetalPrices = async (
  _: Record<string, never>,
): Promise<{ configured: boolean; refreshed: boolean }> => {
  const provider = getMetalProviderConfig({});
  if (!provider) return { configured: false, refreshed: false };
  const configured = true;

  const lockKey = `precious-metals:${provider.name}:lock`;
  const token = randomUUID();
  let acquired = false;
  try {
    acquired = (await redisClient.set(lockKey, token, 'PX', 45_000, 'NX')) === 'OK';
    if (!acquired) return { configured, refreshed: false };
    const beforeRequest = async (): Promise<void> => {
      // Gold-API.com prohibits bursts even though real-time requests have no advertised quota.
      if (provider.minRequestIntervalMs === 0) return;
      const reserveSlot = () =>
        redisClient.set(`precious-metals:${provider.name}:request`, '1', 'PX', provider.minRequestIntervalMs, 'NX');
      if ((await reserveSlot()) === 'OK') return;
      await new Promise((resolve) => setTimeout(resolve, provider.minRequestIntervalMs));
      if ((await reserveSlot()) !== 'OK') throw new Error('Precious metal request pacing unavailable');
    };
    let refreshed = false;
    for (const metal of PRECIOUS_METALS) {
      const saved = await refreshMetal({ metal, provider, beforeRequest });
      refreshed ||= saved;
    }
    return { configured, refreshed };
  } catch {
    logger.warn('Precious metal quote refresh unavailable; retaining the last successful quotes');
    return { configured, refreshed: false };
  } finally {
    if (acquired) {
      try {
        await redisClient.eval(RELEASE_LOCK, 1, lockKey, token);
      } catch {
        // The lease expires automatically; a failed release must not fail a holdings request.
        logger.warn('Precious metal quote refresh lock will expire automatically');
      }
    }
  }
};
