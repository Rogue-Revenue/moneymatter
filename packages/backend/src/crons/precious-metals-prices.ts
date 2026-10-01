import { logger } from '@js/utils/logger';
import { getMetalProviderInfo } from '@services/precious-metals/pricing/provider';
import { refreshMetalPrices } from '@services/precious-metals/pricing/refresh';
import { CronJob } from 'cron';

let job: CronJob | null = null;

const refresh = async (): Promise<void> => {
  try {
    await refreshMetalPrices({});
  } catch {
    logger.warn('Scheduled precious metal quote refresh unavailable');
  }
};

export const preciousMetalsPricesCron = {
  startCron(): void {
    if (
      job ||
      process.env.NODE_ENV === 'test' ||
      process.env.OFFLINE_MODE === 'true' ||
      !getMetalProviderInfo({}).configured
    ) {
      return;
    }
    // Hourly checks catch expiry after a retrieval finishes between scheduled ticks; the cache limits provider calls.
    job = new CronJob('20 * * * *', refresh, null, false, 'UTC');
    job.start();
    void refresh();
  },
  stopCron(): void {
    job?.stop();
    job = null;
  },
};
