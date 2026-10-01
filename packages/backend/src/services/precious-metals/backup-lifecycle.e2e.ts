import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import type {
  CreateMetalHoldingInput,
  MetalHoldingDetailDto,
  MetalsOverviewDto,
  PreciousMetal,
} from '@bt/shared/types/precious-metals';
import { describe, expect, it } from '@jest/globals';
import PreciousMetalEvents from '@models/precious-metals/events.model';
import PreciousMetalHoldings from '@models/precious-metals/holdings.model';
import PreciousMetalQuotes from '@models/precious-metals/quotes.model';
import * as helpers from '@tests/helpers';
import { format } from 'date-fns';

const seedMetal = async ({ metal = 'silver' }: { metal?: PreciousMetal } = {}) => {
  const account = await helpers.createAccount({ raw: true });
  const category = await helpers.addCustomCategory({ name: 'Metal receipt', color: '#123456', raw: true });
  const [transaction] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId: account.id,
      amount: 100,
      transactionType: TRANSACTION_TYPES.expense,
      categoryId: category.id,
    }),
    raw: true,
  });
  const holding = await helpers.makeRequest<MetalHoldingDetailDto, true>({
    method: 'post',
    url: '/precious-metals',
    raw: true,
    payload: {
      name: `Backed up ${metal} round`,
      metal,
      form: 'round',
      weightPerItem: '1',
      weightUnit: 'troy_oz',
      weightBasis: 'fine',
      purity: '0.999',
      currencyCode: global.BASE_CURRENCY_CODE,
      pricingMode: 'manual',
      storageNotes: 'Safe drawer',
    } satisfies CreateMetalHoldingInput,
  });
  await helpers.makeRequest({
    method: 'post',
    url: `/precious-metals/${holding.id}/events`,
    raw: true,
    payload: {
      type: 'purchase',
      date: format(new Date(), 'yyyy-MM-dd'),
      quantity: '2',
      totalAmount: 100,
      transactionId: transaction!.id,
    },
  });
  await helpers.makeRequest({
    method: 'post',
    url: `/precious-metals/${holding.id}/quotes`,
    raw: true,
    payload: { currencyCode: global.BASE_CURRENCY_CODE, pricePerTroyOz: 60, asOf: new Date().toISOString() },
  });
  return { holding, account, category, transaction: transaction! };
};

describe('Precious metal backup and account lifecycle', () => {
  it.each(['silver', 'platinum'] as const)(
    'restores owned %s lots, quotes and transaction snapshots with remapped ids while preserving the source',
    async (metal) => {
      const source = await seedMetal({ metal });
      const backup = await helpers.exportBackup();
      expect(backup.statusCode).toBe(200);
      const archive = helpers.parseBackupArchive({ buffer: backup.body });
      expect(archive.readData({ name: 'precious-metal-holdings' })).toHaveLength(1);
      expect(archive.readData({ name: 'precious-metal-events' })).toHaveLength(1);
      expect(archive.readData({ name: 'precious-metal-quotes' })).toHaveLength(1);

      const target = await helpers.provisionSecondUserWithBaseCurrency();
      await helpers.asUser({
        cookies: target.cookies,
        fn: async () => {
          const restore = await helpers.withSelfHost(() =>
            helpers.restoreBackup({ fileContent: backup.body.toString('base64') }),
          );
          expect(restore.statusCode).toBe(200);
          const status = await helpers.waitForRestore({ jobId: restore.jobId! });
          expect(status.status).toBe('completed');
          const overview = await helpers.makeRequest<MetalsOverviewDto, true>({
            method: 'get',
            url: '/precious-metals',
            raw: true,
          });
          expect(overview.holdings).toHaveLength(1);
          const restored = overview.holdings[0]!;
          expect(restored.metal).toBe(metal);
          expect(restored.id).not.toBe(source.holding.id);
          expect(restored.storageNotes).toBe('Safe drawer');
          expect(restored.valuation.spotValue).toBe(120);

          const detail = await helpers.makeRequest<MetalHoldingDetailDto, true>({
            method: 'get',
            url: `/precious-metals/${restored.id}`,
            raw: true,
          });
          expect(detail.lots).toHaveLength(1);
          expect(detail.quotes).toHaveLength(1);
          expect(detail.events[0]!.transactionId).not.toBe(source.transaction.id);

          const targetBackup = await helpers.exportBackup();
          const targetArchive = helpers.parseBackupArchive({ buffer: targetBackup.body });
          const events = targetArchive.readData({ name: 'precious-metal-events' }) as Array<{
            originalTransactionState: { accountId: string; categoryId: string };
          }>;
          expect(events[0]!.originalTransactionState.accountId).not.toBe(source.account.id);
          expect(events[0]!.originalTransactionState.categoryId).not.toBe(source.category.id);
          await helpers.makeRequest({
            method: 'delete',
            url: `/precious-metals/${restored.id}/events/${detail.events[0]!.id}/link`,
            raw: true,
          });
          const transactions = await helpers.getTransactions({ raw: true });
          expect(transactions).toHaveLength(1);
          expect(transactions[0]!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);
          expect(transactions[0]!.accountId).toBe(events[0]!.originalTransactionState.accountId);
        },
      });

      const sourceDetail = await helpers.makeRequest<MetalHoldingDetailDto, true>({
        method: 'get',
        url: `/precious-metals/${source.holding.id}`,
        raw: true,
      });
      expect(sourceDetail.events[0]!.transactionId).toBe(source.transaction.id);
      expect(sourceDetail.valuation.spotValue).toBe(120);
    },
  );

  it('wipes the complete user-owned metal ledger and private quotes', async () => {
    const { holding } = await seedMetal();
    const result = await helpers.wipeUserData();
    expect(result.statusCode).toBe(200);
    expect(await PreciousMetalHoldings.count({ where: { id: holding.id } })).toBe(0);
    expect(await PreciousMetalEvents.count({ where: { holdingId: holding.id } })).toBe(0);
    expect(await PreciousMetalQuotes.count({ where: { holdingId: holding.id } })).toBe(0);
  });

  it('cascades user deletion through holdings, events and private quote history', async () => {
    const { holding } = await seedMetal();
    const result = await helpers.makeRequest({ method: 'delete', url: '/user/delete' });
    expect(result.statusCode).toBe(200);
    expect(await PreciousMetalHoldings.count({ where: { id: holding.id } })).toBe(0);
    expect(await PreciousMetalEvents.count({ where: { holdingId: holding.id } })).toBe(0);
    expect(await PreciousMetalQuotes.count({ where: { holdingId: holding.id } })).toBe(0);
  });
});
