import { TRANSACTION_TYPES } from '@bt/shared/types';
import type { CreateMetalHoldingInput, MetalHoldingDetailDto } from '@bt/shared/types/precious-metals';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { format, subDays } from 'date-fns';

const createHolding = ({ openingLot }: { openingLot?: CreateMetalHoldingInput['openingLot'] } = {}) =>
  helpers.makeRequest<MetalHoldingDetailDto, true>({
    method: 'post',
    url: '/precious-metals',
    payload: {
      name: 'History gold coins',
      metal: 'gold',
      form: 'coin',
      weightPerItem: '1',
      weightUnit: 'troy_oz',
      weightBasis: 'fine',
      purity: '0.9999',
      currencyCode: global.BASE_CURRENCY_CODE,
      pricingMode: 'manual',
      ...(openingLot ? { openingLot } : {}),
    } satisfies CreateMetalHoldingInput,
    raw: true,
  });

const createQuote = ({ holdingId, asOf }: { holdingId: string; asOf: string }) =>
  helpers.makeRequest({
    method: 'post',
    url: `/precious-metals/${holdingId}/quotes`,
    payload: { pricePerTroyOz: 120, currencyCode: global.BASE_CURRENCY_CODE, asOf },
    raw: true,
  });

describe('Precious metals in net worth history', () => {
  it('adds platinum alongside gold and silver once in the same metals bucket', async () => {
    const today = format(new Date(), 'yyyy-MM-dd');
    for (const { metal, quantity, pricePerTroyOz } of [
      { metal: 'gold' as const, quantity: '1', pricePerTroyOz: 2000 },
      { metal: 'silver' as const, quantity: '2', pricePerTroyOz: 25 },
      { metal: 'platinum' as const, quantity: '3', pricePerTroyOz: 1000 },
    ]) {
      const holding = await helpers.createMetalHolding({
        payload: helpers.buildMetalHoldingPayload({
          overrides: { metal, openingLot: { date: today, quantity, totalAmount: null } },
        }),
        raw: true,
      });
      await helpers.createMetalQuote({
        holdingId: holding.id,
        payload: { pricePerTroyOz, currencyCode: global.BASE_CURRENCY_CODE, asOf: new Date().toISOString() },
        raw: true,
      });
    }
    const result = await helpers.getNetWorthHistory({ from: today, to: today, granularity: 'monthly', raw: true });
    expect(result.points).toHaveLength(1);
    expect(result.points[0]).toMatchObject({
      assets: { cash: 0, investments: 0, preciousMetals: 5050 },
      netWorth: 5050,
      unvaluedMetalsCount: 0,
    });
    expect(await helpers.getTransactions({ raw: true })).toEqual([]);
  });

  it('returns a zero metals bucket without missing valuations when there is no inventory', async () => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const result = await helpers.getNetWorthHistory({ from: today, to: today, granularity: 'monthly', raw: true });

    expect(result.points).toHaveLength(1);
    expect(result.points[0]).toMatchObject({
      assets: { preciousMetals: 0 },
      unvaluedMetalsCount: 0,
      staleMetalsCount: 0,
    });
  });

  it('adds metal value once while matched purchases and sales retain one bank cash movement', async () => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ initialBalance: 1000 }),
      raw: true,
    });
    const holding = await createHolding();
    const purchaseDate = new Date().toISOString();
    const [purchase] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 200,
        transactionType: TRANSACTION_TYPES.expense,
        time: purchaseDate,
      }),
      raw: true,
    });
    await helpers.makeRequest({
      method: 'post',
      url: `/precious-metals/${holding.id}/events`,
      payload: { type: 'purchase', date: today, quantity: '2', totalAmount: 200, transactionId: purchase!.id },
      raw: true,
    });
    await createQuote({ holdingId: holding.id, asOf: purchaseDate });

    const beforeSale = await helpers.getNetWorthHistory({ from: today, to: today, granularity: 'monthly', raw: true });
    expect(beforeSale.points[0]).toMatchObject({
      assets: { cash: 800, investments: 0, preciousMetals: 240 },
      netWorth: 1040,
      unvaluedMetalsCount: 0,
    });

    const saleDate = new Date().toISOString();
    const [sale] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 130,
        transactionType: TRANSACTION_TYPES.income,
        time: saleDate,
      }),
      raw: true,
    });
    await helpers.makeRequest({
      method: 'post',
      url: `/precious-metals/${holding.id}/events`,
      payload: { type: 'sale', date: today, quantity: '1', totalAmount: 130, transactionId: sale!.id },
      raw: true,
    });

    const [combined, report, cashFlow] = await Promise.all([
      helpers.getCombinedBalanceHistory({ from: today, to: today, raw: true }),
      helpers.getNetWorthHistory({ from: today, to: today, granularity: 'monthly', raw: true }),
      helpers.getCashFlow({ from: today, to: today, granularity: 'monthly', raw: true }),
    ]);
    expect(combined).toHaveLength(1);
    expect(combined[0]).toMatchObject({ accountsBalance: 930, metalsBalance: 120, totalBalance: 1050 });
    expect(report.points[0]).toMatchObject({ assets: { cash: 930, preciousMetals: 120 }, netWorth: 1050 });
    expect(cashFlow.periods.every((period) => period.income === 0 && period.expenses === 0)).toBe(true);
  });

  it('keeps unknown historical values explicit and never borrows later quotes', async () => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const acquisitionDay = format(subDays(new Date(), 6), 'yyyy-MM-dd');
    const unpricedDay = format(subDays(new Date(), 5), 'yyyy-MM-dd');
    const quoteDay = format(subDays(new Date(), 4), 'yyyy-MM-dd');
    const holding = await createHolding({
      openingLot: { date: acquisitionDay, quantity: '2', totalAmount: null },
    });
    await createQuote({ holdingId: holding.id, asOf: `${quoteDay}T00:00:00.000Z` });

    const combined = await helpers.getCombinedBalanceHistory({ from: acquisitionDay, to: today, raw: true });
    expect(combined.find((point) => point.date === unpricedDay)).toMatchObject({
      metalsBalance: 0,
      unvaluedMetalsCount: 1,
      staleMetalsCount: 0,
    });
    expect(combined.find((point) => point.date === quoteDay)).toMatchObject({
      metalsBalance: 240,
      unvaluedMetalsCount: 0,
      staleMetalsCount: 0,
    });
    expect(combined.find((point) => point.date === today)).toMatchObject({
      metalsBalance: 240,
      unvaluedMetalsCount: 0,
      staleMetalsCount: 1,
    });

    const earlierReport = await helpers.getNetWorthHistory({
      from: acquisitionDay,
      to: unpricedDay,
      granularity: 'monthly',
      raw: true,
    });
    expect(earlierReport.points.at(-1)).toMatchObject({ assets: { preciousMetals: 0 }, unvaluedMetalsCount: 1 });
    const todayReport = await helpers.getNetWorthHistory({ from: today, to: today, granularity: 'monthly', raw: true });
    expect(todayReport.points[0]).toMatchObject({ assets: { preciousMetals: 240 }, staleMetalsCount: 1 });

    const automaticRange = await helpers.getCombinedBalanceHistory({ raw: true });
    expect(automaticRange[0]!.date).toBe(acquisitionDay);
  });
});
