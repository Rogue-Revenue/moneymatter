import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import type { CreateMetalEventInput, CreateMetalHoldingInput } from '@bt/shared/types/precious-metals';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';

const originalProviderKey = process.env.GOLDAPI_API_KEY;
const originalProvider = process.env.PRECIOUS_METALS_PRICE_PROVIDER;
const originalOfflineMode = process.env.OFFLINE_MODE;
const january = '2025-01-01';
const february = '2025-02-01';
const march = '2025-03-01';
const expensePeriod = { from: '2025-01-01', to: '2025-12-31', raw: true as const };

beforeEach(() => {
  delete process.env.GOLDAPI_API_KEY;
  process.env.PRECIOUS_METALS_PRICE_PROVIDER = 'none';
});
afterEach(() => {
  if (originalProviderKey === undefined) delete process.env.GOLDAPI_API_KEY;
  else process.env.GOLDAPI_API_KEY = originalProviderKey;
  if (originalProvider === undefined) delete process.env.PRECIOUS_METALS_PRICE_PROVIDER;
  else process.env.PRECIOUS_METALS_PRICE_PROVIDER = originalProvider;
  if (originalOfflineMode === undefined) delete process.env.OFFLINE_MODE;
  else process.env.OFFLINE_MODE = originalOfflineMode;
});

const createOpening = ({ overrides = {} }: { overrides?: Partial<CreateMetalHoldingInput> } = {}) =>
  helpers.createMetalHolding({
    payload: helpers.buildMetalHoldingPayload({
      overrides: { openingLot: { date: january, quantity: '2', totalAmount: 200 }, ...overrides },
    }),
    raw: true,
  });

const createPurchase = async () => {
  const holding = await helpers.createMetalHolding({ raw: true });
  return helpers.createMetalEvent({
    holdingId: holding.id,
    payload: { type: 'purchase', date: january, quantity: '2', totalAmount: 200 },
    raw: true,
  });
};

const createCashTransaction = async ({
  amount = 200,
  transactionType = TRANSACTION_TYPES.expense,
}: { amount?: number; transactionType?: TRANSACTION_TYPES } = {}) => {
  const account = await helpers.createAccount({ raw: true });
  const user = await helpers.getUserInfo({ raw: true });
  const [transaction] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId: account.id,
      categoryId: user.defaultCategoryId,
      amount,
      transactionType,
      time: `${january}T12:00:00.000Z`,
    }),
    raw: true,
  });
  return { account, transaction };
};

describe('Physical precious metal holdings HTTP lifecycle', () => {
  it('returns an empty overview with external requests disabled in manual mode', async () => {
    const result = await helpers.listMetalHoldings({ raw: true });
    expect(result.holdings).toEqual([]);
    expect(result.provider).toEqual({ name: 'none', configured: false, refreshHours: 24 });
    expect(await helpers.refreshMetalPrices({ raw: true })).toEqual({ configured: false, refreshed: false });
  });

  it('reports the default keyless provider without a credential', async () => {
    delete process.env.PRECIOUS_METALS_PRICE_PROVIDER;
    delete process.env.OFFLINE_MODE;
    const result = await helpers.listMetalHoldings({ raw: true });
    expect(result.provider).toEqual({ name: 'gold-api.com', configured: true, refreshHours: 24 });
    expect(result.holdings).toEqual([]);
  });

  it('requires authentication for every precious metal endpoint', async () => {
    const id = generateRandomRecordId();
    const eventId = generateRandomRecordId();
    await helpers.withoutSession(async () => {
      for (const { method, url } of [
        { method: 'get' as const, url: '/precious-metals' },
        { method: 'post' as const, url: '/precious-metals' },
        { method: 'get' as const, url: `/precious-metals/${id}` },
        { method: 'patch' as const, url: `/precious-metals/${id}` },
        { method: 'post' as const, url: '/precious-metals/refresh' },
        { method: 'post' as const, url: `/precious-metals/${id}/events` },
        { method: 'delete' as const, url: `/precious-metals/${id}/events/${eventId}` },
        { method: 'post' as const, url: `/precious-metals/${id}/events/${eventId}/link` },
        { method: 'delete' as const, url: `/precious-metals/${id}/events/${eventId}/link` },
        { method: 'post' as const, url: `/precious-metals/${id}/quotes` },
      ]) {
        expect((await helpers.makeRequest({ method, url })).statusCode).toBe(401);
      }
    });
  });

  it('creates an empty holding and returns not-found for an absent detail', async () => {
    const holding = await helpers.createMetalHolding({ raw: true });
    expect(holding.events).toEqual([]);
    expect(holding.lots).toEqual([]);
    expect(holding.quotes).toEqual([]);
    expect(holding.valuation).toMatchObject({ quantity: '0', status: 'empty', spotValue: 0 });
    const detail = await helpers.getMetalHolding({ holdingId: holding.id, raw: true });
    expect(detail.id).toBe(holding.id);
    expect((await helpers.listMetalHoldings({ raw: true })).holdings.map(({ id }) => id)).toEqual([holding.id]);
    expect((await helpers.getMetalHolding({ holdingId: generateRandomRecordId() })).statusCode).toBe(404);
    expect((await helpers.makeRequest({ method: 'get', url: '/precious-metals/invalid-id' })).statusCode).toBe(422);
  });

  it('records an unknown-cost opening lot without inventing cash or spot value', async () => {
    const cashBefore = await helpers.getAccounts();
    const holding = await createOpening({
      overrides: { openingLot: { date: january, quantity: '2', totalAmount: null } },
    });
    expect(holding.events).toHaveLength(1);
    expect(holding.events[0]).toMatchObject({ type: 'opening', totalAmount: null, transactionId: null });
    expect(holding.valuation).toMatchObject({
      quantity: '2',
      fineGrams: '62.2069536',
      knownCostBasis: 0,
      unknownCostQuantity: '2',
      costBasisComplete: false,
      spotValue: null,
      unrealizedGain: null,
      status: 'missing_price',
    });
    expect(await helpers.getTransactions({ raw: true })).toEqual([]);
    expect(await helpers.getAccounts()).toEqual(cashBefore);
  });

  it.each(['coin', 'bar', 'round'] as const)(
    'creates a platinum %s with explicit gross purity and unknown cost',
    async (form) => {
      const holding = await createOpening({
        overrides: {
          name: `Synthetic platinum ${form}`,
          metal: 'platinum',
          form,
          weightPerItem: '10',
          weightUnit: 'g',
          weightBasis: 'gross',
          purity: '0.95',
          openingLot: { date: january, quantity: '2', totalAmount: null },
        },
      });
      expect(holding).toMatchObject({ metal: 'platinum', form });
      expect(holding.valuation).toMatchObject({
        fineGrams: '19',
        unknownCostQuantity: '2',
        costBasisComplete: false,
        spotValue: null,
        unrealizedGain: null,
      });
      expect(await helpers.getTransactions({ raw: true })).toEqual([]);
    },
  );

  it('values platinum lots after a partial FIFO sale without applying purity to fine weight again', async () => {
    const holding = await createOpening({
      overrides: {
        name: 'Synthetic platinum bars',
        metal: 'platinum',
        form: 'bar',
        purity: '0.9995',
        openingLot: { date: january, quantity: '2', totalAmount: 2000 },
      },
    });
    await helpers.createMetalQuote({
      holdingId: holding.id,
      payload: { pricePerTroyOz: 1000, currencyCode: holding.currencyCode, asOf: `${january}T00:00:00Z` },
      raw: true,
    });
    await helpers.createMetalEvent({
      holdingId: holding.id,
      payload: { type: 'purchase', date: february, quantity: '3', totalAmount: 3300 },
      raw: true,
    });
    const sold = await helpers.createMetalEvent({
      holdingId: holding.id,
      payload: { type: 'sale', date: march, quantity: '3', totalAmount: 3900 },
      raw: true,
    });
    expect(sold.valuation).toMatchObject({
      quantity: '2',
      fineGrams: '62.2069536',
      fineTroyOunces: '2',
      knownCostBasis: 2200,
      costBasisComplete: true,
      spotValue: 2000,
      unrealizedGain: -200,
      realizedGain: 800,
    });
    expect(sold.valuation.quote).toMatchObject({ metal: 'platinum', isManual: true });
    expect(sold.events.find((event) => event.type === 'sale')).toMatchObject({ costBasis: 3100, realizedGain: 800 });
    expect(await helpers.getTransactions({ raw: true })).toEqual([]);
  });

  it.each([
    { weightBasis: 'gross' as const, expected: '27.45' },
    { weightBasis: 'fine' as const, expected: '30' },
  ])(
    'interprets $weightBasis grams explicitly and applies purity only to gross weight',
    async ({ weightBasis, expected }) => {
      const holding = await createOpening({
        overrides: {
          weightUnit: 'g',
          weightPerItem: '10',
          weightBasis,
          purity: '0.915',
          openingLot: { date: january, quantity: '3', totalAmount: 300 },
        },
      });
      expect(holding.valuation.fineGrams).toBe(expected);
    },
  );

  it.each([
    { weightPerItem: '0' },
    { weightPerItem: '-1' },
    { weightPerItem: 'NaN' },
    { purity: '0' },
    { purity: '1.1' },
    { purity: 'abc' },
    { metal: 'palladium' },
    { name: '' },
    { openingLot: { date: '2025-02-30', quantity: '1', totalAmount: 100 } },
    { openingLot: { date: '2999-01-01', quantity: '1', totalAmount: 100 } },
  ])('rejects invalid creation input %# without creating a holding', async (overrides) => {
    const response = await helpers.makeRequest({
      method: 'post',
      url: '/precious-metals',
      payload: { ...helpers.buildMetalHoldingPayload(), ...overrides },
    });
    expect(response.statusCode).toBe(422);
    expect((await helpers.listMetalHoldings({ raw: true })).holdings).toEqual([]);
  });

  it('updates descriptive metadata while preserving physical attributes and currency', async () => {
    const holding = await createOpening();
    const updated = await helpers.updateMetalHolding({
      holdingId: holding.id,
      payload: { name: 'Vault coins', storageNotes: 'Box 7' },
      raw: true,
    });
    expect(updated).toMatchObject({
      name: 'Vault coins',
      storageNotes: 'Box 7',
      currencyCode: holding.currencyCode,
      weightPerItem: holding.weightPerItem,
    });
    for (const payload of [{ currencyCode: 'USD' }, { weightPerItem: '5' }, { purity: '0.5' }, { metal: 'silver' }]) {
      expect(
        (await helpers.makeRequest({ method: 'patch', url: `/precious-metals/${holding.id}`, payload })).statusCode,
      ).toBe(422);
    }
    expect((await helpers.getMetalHolding({ holdingId: holding.id, raw: true })).valuation.fineGrams).toBe(
      '62.2069536',
    );
    expect(
      (await helpers.updateMetalHolding({ holdingId: generateRandomRecordId(), payload: { name: 'Missing' } }))
        .statusCode,
    ).toBe(404);
  });

  it('isolates list, detail, mutation, quote, and linking operations by owner', async () => {
    const holding = await createPurchase();
    const other = await helpers.provisionSecondUserWithBaseCurrency();
    await helpers.asUser({
      cookies: other.cookies,
      fn: async () => {
        expect((await helpers.listMetalHoldings({ raw: true })).holdings).toEqual([]);
        expect((await helpers.getMetalHolding({ holdingId: holding.id })).statusCode).toBe(404);
        expect(
          (await helpers.updateMetalHolding({ holdingId: holding.id, payload: { name: 'Other user' } })).statusCode,
        ).toBe(404);
        expect(
          (
            await helpers.createMetalEvent({
              holdingId: holding.id,
              payload: { type: 'purchase', date: january, quantity: '1', totalAmount: 10 },
            })
          ).statusCode,
        ).toBe(404);
        expect(
          (await helpers.deleteMetalEvent({ holdingId: holding.id, eventId: holding.events[0]!.id })).statusCode,
        ).toBe(404);
        expect(
          (
            await helpers.createMetalQuote({
              holdingId: holding.id,
              payload: { pricePerTroyOz: 150, currencyCode: global.BASE_CURRENCY.code, asOf: `${january}T00:00:00Z` },
            })
          ).statusCode,
        ).toBe(404);
        expect(
          (
            await helpers.linkMetalEvent({
              holdingId: holding.id,
              eventId: holding.events[0]!.id,
              transactionId: generateRandomRecordId(),
            })
          ).statusCode,
        ).toBe(404);
        expect(
          (await helpers.unlinkMetalEvent({ holdingId: holding.id, eventId: holding.events[0]!.id })).statusCode,
        ).toBe(404);
      },
    });
    expect((await helpers.getMetalHolding({ holdingId: holding.id, raw: true })).valuation.quantity).toBe('2');
  });

  it('consumes purchase lots FIFO across a partial sale using all-in costs', async () => {
    const holding = await createPurchase();
    await helpers.createMetalEvent({
      holdingId: holding.id,
      payload: { type: 'purchase', date: february, quantity: '2', totalAmount: 400 },
      raw: true,
    });
    const sold = await helpers.createMetalEvent({
      holdingId: holding.id,
      payload: { type: 'sale', date: march, quantity: '3', totalAmount: 750 },
      raw: true,
    });
    expect(sold.valuation).toMatchObject({
      quantity: '1',
      knownCostBasis: 200,
      costBasisComplete: true,
      realizedGain: 350,
    });
    expect(sold.events.at(-1)).toMatchObject({ type: 'sale', costBasis: 400, realizedGain: 350 });
    expect(sold.lots.map(({ remainingQuantity, remainingCost }) => ({ remainingQuantity, remainingCost }))).toEqual([
      { remainingQuantity: '0', remainingCost: 0 },
      { remainingQuantity: '1', remainingCost: 200 },
    ]);
    expect(await helpers.getTransactions({ raw: true })).toEqual([]);
  });

  it('preserves unknown realized gain when FIFO consumes an unknown-cost lot', async () => {
    const holding = await createOpening({
      overrides: { openingLot: { date: january, quantity: '1', totalAmount: null } },
    });
    await helpers.createMetalEvent({
      holdingId: holding.id,
      payload: { type: 'purchase', date: february, quantity: '1', totalAmount: 200 },
      raw: true,
    });
    const sold = await helpers.createMetalEvent({
      holdingId: holding.id,
      payload: { type: 'sale', date: march, quantity: '1.5', totalAmount: 300 },
      raw: true,
    });
    expect(sold.events.at(-1)).toMatchObject({ costBasis: null, realizedGain: null });
    expect(sold.valuation).toMatchObject({
      quantity: '0.5',
      knownCostBasis: 100,
      costBasisComplete: true,
      realizedGain: null,
    });
  });

  it('rolls back overselling and a backdated sale that would invalidate later inventory', async () => {
    const holding = await createPurchase();
    const oversell = await helpers.createMetalEvent({
      holdingId: holding.id,
      payload: { type: 'sale', date: february, quantity: '3', totalAmount: 300 },
    });
    expect(oversell.statusCode).toBe(422);
    await helpers.createMetalEvent({
      holdingId: holding.id,
      payload: { type: 'sale', date: march, quantity: '2', totalAmount: 300 },
      raw: true,
    });
    const backdated = await helpers.createMetalEvent({
      holdingId: holding.id,
      payload: { type: 'sale', date: february, quantity: '1', totalAmount: 150 },
    });
    expect(backdated.statusCode).toBe(422);
    const after = await helpers.getMetalHolding({ holdingId: holding.id, raw: true });
    expect(after.events).toHaveLength(2);
    expect(after.valuation).toMatchObject({ quantity: '0', realizedGain: 100 });
  });

  it.each([
    { quantity: '0' },
    { quantity: '-1' },
    { quantity: 'abc' },
    { totalAmount: -1 },
    { date: '2999-01-01' },
    { date: '2025-02-30' },
  ])('rejects invalid activity %# without mutating inventory', async (overrides) => {
    const holding = await createPurchase();
    const payload: CreateMetalEventInput = {
      type: 'purchase',
      date: february,
      quantity: '1',
      totalAmount: 100,
      ...overrides,
    };
    expect((await helpers.createMetalEvent({ holdingId: holding.id, payload })).statusCode).toBe(422);
    expect((await helpers.getMetalHolding({ holdingId: holding.id, raw: true })).events).toHaveLength(1);
  });

  it('deletes a sale and then its purchase, while rejecting a deletion that strands a sale', async () => {
    const holding = await createPurchase();
    const sold = await helpers.createMetalEvent({
      holdingId: holding.id,
      payload: { type: 'sale', date: february, quantity: '1', totalAmount: 150 },
      raw: true,
    });
    expect((await helpers.deleteMetalEvent({ holdingId: holding.id, eventId: holding.events[0]!.id })).statusCode).toBe(
      422,
    );
    expect((await helpers.getMetalHolding({ holdingId: holding.id, raw: true })).events).toHaveLength(2);
    expect(
      (await helpers.deleteMetalEvent({ holdingId: holding.id, eventId: sold.events.at(-1)!.id })).statusCode,
    ).toBe(200);
    expect((await helpers.getMetalHolding({ holdingId: holding.id, raw: true })).valuation.quantity).toBe('2');
    expect((await helpers.deleteMetalEvent({ holdingId: holding.id, eventId: holding.events[0]!.id })).statusCode).toBe(
      200,
    );
    expect((await helpers.getMetalHolding({ holdingId: holding.id, raw: true })).valuation.status).toBe('empty');
    expect(
      (await helpers.deleteMetalEvent({ holdingId: holding.id, eventId: generateRandomRecordId() })).statusCode,
    ).toBe(404);
  });

  it('serializes concurrent sales so only the covered sale is committed', async () => {
    const holding = await createPurchase();
    const results = await Promise.all([
      helpers.createMetalEvent({
        holdingId: holding.id,
        payload: { type: 'sale', date: february, quantity: '1.5', totalAmount: 225 },
      }),
      helpers.createMetalEvent({
        holdingId: holding.id,
        payload: { type: 'sale', date: february, quantity: '1.5', totalAmount: 225 },
      }),
    ]);
    expect(results.map(({ statusCode }) => statusCode).toSorted((a, b) => a - b)).toEqual([200, 422]);
    const after = await helpers.getMetalHolding({ holdingId: holding.id, raw: true });
    expect(after.valuation.quantity).toBe('0.5');
    expect(after.events).toHaveLength(2);
  });

  it('uses a dated manual quote without credentials and keeps it private to its holding', async () => {
    const holding = await createOpening();
    const other = await createOpening({ overrides: { name: 'Other gold' } });
    const quoted = await helpers.createMetalQuote({
      holdingId: holding.id,
      payload: { pricePerTroyOz: 150, currencyCode: global.BASE_CURRENCY.code, asOf: `${february}T12:00:00Z` },
      raw: true,
    });
    expect(quoted.valuation).toMatchObject({ spotValue: 300, unrealizedGain: 100, status: 'stale' });
    expect(quoted.valuation.quote).toMatchObject({
      asOf: `${february}T12:00:00.000Z`,
      source: 'manual',
      isManual: true,
      isStale: true,
    });
    expect(quoted.quotes).toHaveLength(1);
    expect((await helpers.getMetalHolding({ holdingId: other.id, raw: true })).valuation.spotValue).toBeNull();
    expect(await helpers.refreshMetalPrices({ raw: true })).toEqual({ configured: false, refreshed: false });
    expect((await helpers.getMetalHolding({ holdingId: holding.id, raw: true })).valuation.spotValue).toBe(300);
  });

  it.each([{ pricePerTroyOz: 0 }, { pricePerTroyOz: -1 }, { asOf: '2999-01-01T00:00:00Z' }, { asOf: 'not-a-date' }])(
    'rejects invalid manual quote %# and preserves the last good quote',
    async (overrides) => {
      const holding = await createOpening();
      const payload = { pricePerTroyOz: 150, currencyCode: global.BASE_CURRENCY.code, asOf: `${february}T00:00:00Z` };
      await helpers.createMetalQuote({ holdingId: holding.id, payload, raw: true });
      expect(
        (await helpers.createMetalQuote({ holdingId: holding.id, payload: { ...payload, ...overrides } })).statusCode,
      ).toBe(422);
      const after = await helpers.getMetalHolding({ holdingId: holding.id, raw: true });
      expect(after.quotes).toHaveLength(1);
      expect(after.valuation.spotValue).toBe(300);
    },
  );
});

describe('Physical metal cash links', () => {
  it('links and unlinks an existing purchase expense without duplicating cash or expenses', async () => {
    const holding = await createPurchase();
    const { account, transaction } = await createCashTransaction();
    const before = await helpers.getAccount({ id: account.id, raw: true });
    expect(await helpers.getExpensesAmountForPeriod(expensePeriod)).toBe(200);
    expect(
      (
        await helpers.linkMetalEvent({
          holdingId: holding.id,
          eventId: holding.events[0]!.id,
          transactionId: transaction.id,
        })
      ).statusCode,
    ).toBe(200);
    const linked = await helpers.getTransactionById({ id: transaction.id, raw: true });
    expect(linked?.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_to_precious_metals);
    expect((await helpers.getMetalHolding({ holdingId: holding.id, raw: true })).events[0]!.transactionId).toBe(
      transaction.id,
    );
    expect((await helpers.getTransactions({ raw: true })).map(({ id }) => id)).toEqual([transaction.id]);
    expect((await helpers.getAccount({ id: account.id, raw: true })).currentBalance).toBe(before.currentBalance);
    expect(await helpers.getExpensesAmountForPeriod(expensePeriod)).toBe(0);
    expect((await helpers.unlinkMetalEvent({ holdingId: holding.id, eventId: holding.events[0]!.id })).statusCode).toBe(
      200,
    );
    expect((await helpers.getTransactionById({ id: transaction.id, raw: true }))?.transferNature).toBe(
      TRANSACTION_TRANSFER_NATURE.not_transfer,
    );
    expect((await helpers.getAccount({ id: account.id, raw: true })).currentBalance).toBe(before.currentBalance);
    expect(await helpers.getExpensesAmountForPeriod(expensePeriod)).toBe(200);
    expect((await helpers.unlinkMetalEvent({ holdingId: holding.id, eventId: holding.events[0]!.id })).statusCode).toBe(
      200,
    );
  });

  it('links sale proceeds to income during creation and restores the transaction on event deletion', async () => {
    const holding = await createPurchase();
    const { account, transaction } = await createCashTransaction({
      amount: 150,
      transactionType: TRANSACTION_TYPES.income,
    });
    const before = await helpers.getAccount({ id: account.id, raw: true });
    const sold = await helpers.createMetalEvent({
      holdingId: holding.id,
      payload: { type: 'sale', date: february, quantity: '1', totalAmount: 150, transactionId: transaction.id },
      raw: true,
    });
    const event = sold.events.at(-1)!;
    expect(event.transactionId).toBe(transaction.id);
    expect((await helpers.getTransactionById({ id: transaction.id, raw: true }))?.transferNature).toBe(
      TRANSACTION_TRANSFER_NATURE.transfer_to_precious_metals,
    );
    expect((await helpers.deleteMetalEvent({ holdingId: holding.id, eventId: event.id })).statusCode).toBe(200);
    expect((await helpers.getTransactionById({ id: transaction.id, raw: true }))?.transferNature).toBe(
      TRANSACTION_TRANSFER_NATURE.not_transfer,
    );
    expect((await helpers.getAccount({ id: account.id, raw: true })).currentBalance).toBe(before.currentBalance);
    expect((await helpers.getTransactions({ raw: true })).length).toBe(1);
  });

  it.each([
    { amount: 201, transactionType: TRANSACTION_TYPES.expense },
    { amount: 200, transactionType: TRANSACTION_TYPES.income },
  ])(
    'rejects an amount or direction mismatch without changing the cash transaction %#',
    async ({ amount, transactionType }) => {
      const holding = await createPurchase();
      const { transaction } = await createCashTransaction({ amount, transactionType });
      expect(
        (
          await helpers.linkMetalEvent({
            holdingId: holding.id,
            eventId: holding.events[0]!.id,
            transactionId: transaction.id,
          })
        ).statusCode,
      ).toBe(422);
      expect((await helpers.getTransactionById({ id: transaction.id, raw: true }))?.transferNature).toBe(
        TRANSACTION_TRANSFER_NATURE.not_transfer,
      );
      expect((await helpers.getMetalHolding({ holdingId: holding.id, raw: true })).events[0]!.transactionId).toBeNull();
    },
  );

  it('rejects opening and unknown-cost event links', async () => {
    const holding = await createOpening();
    const { transaction } = await createCashTransaction();
    expect(
      (
        await helpers.linkMetalEvent({
          holdingId: holding.id,
          eventId: holding.events[0]!.id,
          transactionId: transaction.id,
        })
      ).statusCode,
    ).toBe(422);
    const unknown = await helpers.createMetalEvent({
      holdingId: holding.id,
      payload: { type: 'purchase', date: february, quantity: '1', totalAmount: null },
      raw: true,
    });
    expect(
      (
        await helpers.linkMetalEvent({
          holdingId: holding.id,
          eventId: unknown.events.at(-1)!.id,
          transactionId: transaction.id,
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await helpers.createMetalEvent({
          holdingId: holding.id,
          payload: { type: 'opening', date: february, quantity: '1', totalAmount: 200, transactionId: transaction.id },
        })
      ).statusCode,
    ).toBe(422);
  });

  it('rejects a matching amount denominated in a different currency', async () => {
    const currencyCode = global.BASE_CURRENCY.code === 'USD' ? 'EUR' : 'USD';
    const holding = await helpers.createMetalHolding({
      payload: helpers.buildMetalHoldingPayload({ overrides: { currencyCode } }),
      raw: true,
    });
    const purchase = await helpers.createMetalEvent({
      holdingId: holding.id,
      payload: { type: 'purchase', date: january, quantity: '1', totalAmount: 200 },
      raw: true,
    });
    const { transaction } = await createCashTransaction();
    expect(
      (
        await helpers.linkMetalEvent({
          holdingId: holding.id,
          eventId: purchase.events[0]!.id,
          transactionId: transaction.id,
        })
      ).statusCode,
    ).toBe(422);
    expect((await helpers.getMetalHolding({ holdingId: holding.id, raw: true })).events[0]!.transactionId).toBeNull();
  });

  it('rejects duplicate links and rolls back an event when its requested link fails', async () => {
    const holding = await createPurchase();
    const { transaction } = await createCashTransaction();
    expect(
      (
        await helpers.linkMetalEvent({
          holdingId: holding.id,
          eventId: holding.events[0]!.id,
          transactionId: transaction.id,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await helpers.linkMetalEvent({
          holdingId: holding.id,
          eventId: holding.events[0]!.id,
          transactionId: transaction.id,
        })
      ).statusCode,
    ).toBe(422);
    const other = await helpers.createMetalHolding({ raw: true });
    expect(
      (
        await helpers.createMetalEvent({
          holdingId: other.id,
          payload: { type: 'purchase', date: january, quantity: '1', totalAmount: 200, transactionId: transaction.id },
        })
      ).statusCode,
    ).toBe(422);
    expect((await helpers.getMetalHolding({ holdingId: other.id, raw: true })).events).toEqual([]);
  });

  it('allows only one of two concurrent events to match the same bank transaction', async () => {
    const [first, second] = await Promise.all([createPurchase(), createPurchase()]);
    const { transaction } = await createCashTransaction();
    const responses = await Promise.all(
      [first, second].map((holding) =>
        helpers.linkMetalEvent({
          holdingId: holding.id,
          eventId: holding.events[0]!.id,
          transactionId: transaction.id,
        }),
      ),
    );
    expect(responses.map(({ statusCode }) => statusCode).toSorted((a, b) => a - b)).toEqual([200, 422]);
    const results = await Promise.all(
      [first, second].map((holding) => helpers.getMetalHolding({ holdingId: holding.id, raw: true })),
    );
    expect(results.filter((holding) => holding.events[0]!.transactionId === transaction.id)).toHaveLength(1);
    expect(await helpers.getTransactions({ raw: true })).toHaveLength(1);
  });

  it('prevents a cash transaction from being attached to both a portfolio and physical metals', async () => {
    const holding = await createPurchase();
    const { transaction } = await createCashTransaction();
    const portfolio = await helpers.createPortfolio({ raw: true });
    expect(
      (
        await helpers.linkTransactionToPortfolio({
          transactionId: transaction.id,
          payload: { portfolioId: portfolio.id, affectsCash: false },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await helpers.linkMetalEvent({
          holdingId: holding.id,
          eventId: holding.events[0]!.id,
          transactionId: transaction.id,
        })
      ).statusCode,
    ).toBe(422);
    expect((await helpers.unlinkTransactionFromPortfolio({ transactionId: transaction.id })).statusCode).toBe(204);
    expect(
      (
        await helpers.linkMetalEvent({
          holdingId: holding.id,
          eventId: holding.events[0]!.id,
          transactionId: transaction.id,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await helpers.linkTransactionToPortfolio({
          transactionId: transaction.id,
          payload: { portfolioId: portfolio.id, affectsCash: false },
        })
      ).statusCode,
    ).toBe(422);
  });

  it('rejects planned cash transactions and manual budget transactions', async () => {
    const holding = await createPurchase();
    const account = await helpers.createAccount({ raw: true });
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const [planned] = await helpers.createPlannedTransaction({
      payload: { accountId: account.id, amount: 200, time: future },
      raw: true,
    });
    expect(
      (
        await helpers.linkMetalEvent({
          holdingId: holding.id,
          eventId: holding.events[0]!.id,
          transactionId: planned.id,
        })
      ).statusCode,
    ).toBe(422);
    const { transaction } = await createCashTransaction();
    const budget = await helpers.createCustomBudget({ name: 'Synthetic manual budget', autoInclude: false, raw: true });
    expect(
      (await helpers.addTransactionToCustomBudget({ id: budget.id, payload: { transactionIds: [transaction.id] } }))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await helpers.linkMetalEvent({
          holdingId: holding.id,
          eventId: holding.events[0]!.id,
          transactionId: transaction.id,
        })
      ).statusCode,
    ).toBe(422);
    expect((await helpers.getMetalHolding({ holdingId: holding.id, raw: true })).events[0]!.transactionId).toBeNull();
  });

  it('prevents an already linked metal purchase from being added to a manual expense budget', async () => {
    const holding = await createPurchase();
    const { transaction } = await createCashTransaction();
    await helpers.linkMetalEvent({
      holdingId: holding.id,
      eventId: holding.events[0]!.id,
      transactionId: transaction.id,
      raw: true,
    });
    const budget = await helpers.createCustomBudget({ name: 'Synthetic budget', autoInclude: false, raw: true });
    expect(
      (await helpers.addTransactionToCustomBudget({ id: budget.id, payload: { transactionIds: [transaction.id] } }))
        .statusCode,
    ).toBe(422);
    expect((await helpers.getTransactionById({ id: transaction.id, raw: true }))?.transferNature).toBe(
      TRANSACTION_TRANSFER_NATURE.transfer_to_precious_metals,
    );
  });

  it('rejects a foreign cash transaction and missing link/unlink event IDs', async () => {
    const holding = await createPurchase();
    const other = await helpers.provisionSecondUserWithBaseCurrency();
    const foreign = await helpers.asUser({ cookies: other.cookies, fn: () => createCashTransaction() });
    expect(
      (
        await helpers.linkMetalEvent({
          holdingId: holding.id,
          eventId: holding.events[0]!.id,
          transactionId: foreign.transaction.id,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await helpers.linkMetalEvent({
          holdingId: holding.id,
          eventId: generateRandomRecordId(),
          transactionId: foreign.transaction.id,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await helpers.unlinkMetalEvent({ holdingId: holding.id, eventId: generateRandomRecordId() })).statusCode,
    ).toBe(404);
  });

  it('blocks linked cash edits and deletion until the link is removed', async () => {
    const holding = await createPurchase();
    const { transaction } = await createCashTransaction();
    await helpers.linkMetalEvent({
      holdingId: holding.id,
      eventId: holding.events[0]!.id,
      transactionId: transaction.id,
      raw: true,
    });
    expect((await helpers.updateTransaction({ id: transaction.id, payload: { amount: 201 } })).statusCode).toBe(422);
    expect((await helpers.deleteTransaction({ id: transaction.id })).statusCode).toBe(422);
    expect((await helpers.getTransactionById({ id: transaction.id, raw: true }))?.amount).toBe(200);
    await helpers.unlinkMetalEvent({ holdingId: holding.id, eventId: holding.events[0]!.id, raw: true });
    expect((await helpers.updateTransaction({ id: transaction.id, payload: { amount: 201 } })).statusCode).toBe(200);
  });
});
