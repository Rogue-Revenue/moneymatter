import type { RecordId } from '@bt/shared/types';
import { Money } from '@common/types/money';
import ExchangeRates from '@models/exchange-rates.model';
import MetalQuotes from '@models/precious-metals/quotes.model';
import UserExchangeRates from '@models/user-exchange-rates.model';

import { createMetalValuationContext, type MetalValuationHolding, type MetalValuationEvent } from './valuation';

jest.mock('@models/exchange-rates.model', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('@models/user-exchange-rates.model', () => ({ __esModule: true, default: { findAll: jest.fn() } }));
jest.mock('@models/precious-metals/quotes.model', () => ({ __esModule: true, default: { findAll: jest.fn() } }));

const holding: MetalValuationHolding = {
  id: 'holding' as RecordId,
  userId: 1,
  metal: 'gold',
  currencyCode: 'USD',
  pricingMode: 'automatic',
  pricingModeHistory: [{ mode: 'automatic', effectiveAt: '0001-01-01T00:00:00Z' }],
};

const event = ({
  id = 'opening' as RecordId,
  ...overrides
}: Partial<MetalValuationEvent> = {}): MetalValuationEvent => ({
  id: id as RecordId,
  userId: 1,
  holdingId: holding.id,
  type: 'opening',
  date: '2026-01-01',
  createdAt: '2026-01-01T00:00:00Z',
  quantity: '1',
  fineGramsPerItem: '31.1034768',
  currencyCode: 'USD',
  totalAmount: Money.fromDecimal('100'),
  ...overrides,
});

const quote = ({
  id = 'quote',
  price = '150',
  asOf = '2026-01-02T00:00:00Z',
  currencyCode = 'USD',
  userId = null,
  holdingId = null,
}: {
  id?: string;
  price?: string;
  asOf?: string;
  currencyCode?: string;
  userId?: number | null;
  holdingId?: RecordId | null;
} = {}) => ({
  id: id as RecordId,
  metal: 'gold',
  currencyCode,
  userId,
  holdingId,
  pricePerTroyOz: Money.fromDecimal(price),
  asOf: new Date(asOf),
  retrievedAt: new Date(asOf),
  source: holdingId ? 'manual' : 'provider',
});

const rate = ({
  quoteCode,
  rate: rateValue,
  date,
  baseCode = 'USD',
}: {
  quoteCode: string;
  rate: number;
  date: string;
  baseCode?: string;
}) => ({ baseCode, quoteCode, rate: rateValue, date: new Date(date) });

const context = ({
  holdings = [holding],
  events = [event()],
}: {
  holdings?: MetalValuationHolding[];
  events?: MetalValuationEvent[];
} = {}) => createMetalValuationContext({ userId: 1, holdings, events, through: new Date('2026-02-01T23:59:59Z') });

beforeEach(() => {
  jest.mocked(MetalQuotes.findAll).mockReset().mockResolvedValue([]);
  jest.mocked(ExchangeRates.findAll).mockReset().mockResolvedValue([]);
  jest.mocked(UserExchangeRates.findAll).mockReset().mockResolvedValue([]);
});

describe('historical physical metal valuation', () => {
  it('leaves earlier values unknown instead of borrowing a future spot quote', async () => {
    jest.mocked(MetalQuotes.findAll).mockResolvedValue([quote()] as never);
    const ctx = await context();
    const before = ctx.valueHolding({ holding, asOf: new Date('2026-01-01T23:59:59Z') });
    const after = ctx.valueHolding({ holding, asOf: new Date('2026-01-02T23:59:59Z') });
    expect(before.valuation.spotValue).toBeNull();
    expect(before.valuation.unrealizedGain).toBeNull();
    expect(before.valuation.status).toBe('missing_price');
    expect(after.valuation.spotValue).toBe(150);
    expect(after.valuation.unrealizedGain).toBe(50);
  });

  it('uses quote as-of age to mark last good prices stale after 72 hours', async () => {
    jest.mocked(MetalQuotes.findAll).mockResolvedValue([quote()] as never);
    const ctx = await context();
    expect(ctx.valueHolding({ holding, asOf: new Date('2026-01-05T00:00:00Z') }).valuation.status).toBe('current');
    const result = ctx.valueHolding({ holding, asOf: new Date('2026-01-05T00:00:01Z') });
    expect(result.valuation.status).toBe('stale');
    expect(result.valuation.spotValue).toBe(150);
    expect(result.valuation.quote?.isStale).toBe(true);
  });

  it('uses the dated pricing preference and only this holding owner manual quotes', async () => {
    const manual: MetalValuationHolding = {
      ...holding,
      pricingMode: 'manual',
      pricingModeHistory: [...holding.pricingModeHistory, { mode: 'manual', effectiveAt: '2026-01-04T00:00:00Z' }],
    };
    jest.mocked(MetalQuotes.findAll).mockResolvedValue([
      quote(),
      quote({ id: 'mine', price: '190', userId: 1, holdingId: holding.id, asOf: '2026-01-04T00:00:00Z' }),
      quote({ id: 'other-user', price: '999', userId: 2, holdingId: holding.id, asOf: '2026-01-05T00:00:00Z' }),
      quote({
        id: 'other-holding',
        price: '888',
        userId: 1,
        holdingId: 'other' as RecordId,
        asOf: '2026-01-05T00:00:00Z',
      }),
    ] as never);
    const ctx = await context({ holdings: [manual] });
    expect(ctx.valueHolding({ holding: manual, asOf: new Date('2026-01-03T00:00:00Z') }).valuation.spotValue).toBe(150);
    const result = ctx.valueHolding({ holding: manual, asOf: new Date('2026-01-05T00:00:00Z') });
    expect(result.valuation.spotValue).toBe(190);
    expect(result.valuation.quote?.id).toBe('mine');
    expect(result.valuation.quote?.isManual).toBe(true);
  });

  it('does not fall through to automatic prices when manual mode has no dated quote', async () => {
    const manual: MetalValuationHolding = {
      ...holding,
      pricingMode: 'manual',
      pricingModeHistory: [{ mode: 'manual', effectiveAt: '0001-01-01T00:00:00Z' }],
    };
    jest.mocked(MetalQuotes.findAll).mockResolvedValue([quote()] as never);
    const ctx = await context({ holdings: [manual] });
    expect(ctx.valueHolding({ holding: manual, asOf: new Date('2026-01-03T00:00:00Z') }).valuation.status).toBe(
      'missing_price',
    );
  });

  it('converts acquisition basis, sale proceeds and current spot at their respective dates', async () => {
    jest.mocked(MetalQuotes.findAll).mockResolvedValue([quote({ price: '200' })] as never);
    jest
      .mocked(ExchangeRates.findAll)
      .mockResolvedValue([
        rate({ quoteCode: 'EUR', rate: 0.8, date: '2025-12-31T00:00:00Z' }),
        rate({ quoteCode: 'EUR', rate: 0.9, date: '2026-01-02T00:00:00Z' }),
        rate({ quoteCode: 'EUR', rate: 1.2, date: '2026-01-03T00:00:00Z' }),
      ] as never);
    const ctx = await context({
      events: [
        event({ quantity: '2', totalAmount: Money.fromDecimal('200') }),
        event({ id: 'sale' as RecordId, type: 'sale', date: '2026-01-02', totalAmount: Money.fromDecimal('150') }),
      ],
    });
    const result = ctx.valueHolding({ holding, asOf: new Date('2026-01-03T23:59:59Z'), currencyCode: 'EUR' });
    expect(result.valuation.spotValue).toBe(240);
    expect(result.valuation.knownCostBasis).toBe(80);
    expect(result.valuation.unrealizedGain).toBe(160);
    expect(result.valuation.realizedGain).toBe(55);
    expect(result.sales.get('sale' as RecordId)).toEqual({ costBasis: 80, realizedGain: 55 });
    expect(result.lots[0]?.originalCost).toBe(160);
  });

  it('uses a preceding USD pivot observation for both legs and never a future rate', async () => {
    const eurHolding = { ...holding, currencyCode: 'EUR' };
    jest.mocked(MetalQuotes.findAll).mockResolvedValue([quote({ currencyCode: 'GBP', price: '100' })] as never);
    jest
      .mocked(ExchangeRates.findAll)
      .mockResolvedValue([
        rate({ quoteCode: 'GBP', rate: 0.5, date: '2025-01-01T00:00:00Z' }),
        rate({ quoteCode: 'EUR', rate: 0.8, date: '2025-01-01T00:00:00Z' }),
        rate({ quoteCode: 'EUR', rate: 1.5, date: '2026-01-03T20:00:00Z' }),
      ] as never);
    const ctx = await context({ holdings: [eurHolding], events: [event({ currencyCode: 'EUR' })] });
    expect(ctx.valueHolding({ holding: eurHolding, asOf: new Date('2026-01-03T10:00:00Z') }).valuation.spotValue).toBe(
      160,
    );
  });

  it('preserves event attributes exposed through model getters during currency conversion', async () => {
    const values = event();
    const modelEvent = Object.create(
      Object.fromEntries(Object.keys(values).map((key) => [key, values[key as keyof MetalValuationEvent]])),
    ) as MetalValuationEvent;
    jest.mocked(MetalQuotes.findAll).mockResolvedValue([quote()] as never);
    jest
      .mocked(ExchangeRates.findAll)
      .mockResolvedValue([rate({ quoteCode: 'EUR', rate: 0.8, date: '2025-12-31T00:00:00Z' })] as never);
    const ctx = await context({ events: [modelEvent] });
    const result = ctx.valueHolding({ holding, asOf: new Date('2026-01-03T10:00:00Z'), currencyCode: 'EUR' });
    expect(result.valuation.quantity).toBe('1');
    expect(result.valuation.knownCostBasis).toBe(80);
  });

  it('keeps historical values stable when a mutable private exchange rate is updated', async () => {
    jest.mocked(MetalQuotes.findAll).mockResolvedValue([quote()] as never);
    jest
      .mocked(ExchangeRates.findAll)
      .mockResolvedValue([rate({ quoteCode: 'EUR', rate: 0.8, date: '2025-12-31T00:00:00Z' })] as never);
    jest
      .mocked(UserExchangeRates.findAll)
      .mockResolvedValue([
        { ...rate({ quoteCode: 'EUR', rate: 2, date: '2025-12-31T00:00:00Z' }), userId: 1 },
      ] as never);
    const beforeContext = await context();
    const before = beforeContext.valueHolding({ holding, asOf: new Date('2026-01-03T10:00:00Z'), currencyCode: 'EUR' });
    jest
      .mocked(UserExchangeRates.findAll)
      .mockResolvedValue([
        { ...rate({ quoteCode: 'EUR', rate: 3, date: '2025-12-31T00:00:00Z' }), userId: 1 },
      ] as never);
    const afterContext = await context();
    const after = afterContext.valueHolding({ holding, asOf: new Date('2026-01-03T10:00:00Z'), currencyCode: 'EUR' });
    expect(before.valuation.spotValue).toBe(120);
    expect(before.valuation.knownCostBasis).toBe(80);
    expect(after.valuation).toEqual(before.valuation);
  });

  it('leaves missing historical FX unvalued even when a mutable custom rate exists', async () => {
    jest.mocked(MetalQuotes.findAll).mockResolvedValue([quote()] as never);
    jest
      .mocked(UserExchangeRates.findAll)
      .mockResolvedValue([
        { ...rate({ quoteCode: 'EUR', rate: 2, date: '2025-12-31T00:00:00Z' }), userId: 1 },
      ] as never);
    const ctx = await context();
    const result = ctx.valueHolding({ holding, asOf: new Date('2026-01-03T10:00:00Z'), currencyCode: 'EUR' });
    expect(result.valuation.spotValue).toBeNull();
    expect(result.valuation.status).toBe('missing_fx');
  });

  it('reports missing FX as unknown rather than using 1:1 or future observations', async () => {
    jest.mocked(MetalQuotes.findAll).mockResolvedValue([quote()] as never);
    jest
      .mocked(ExchangeRates.findAll)
      .mockResolvedValue([rate({ quoteCode: 'EUR', rate: 2, date: '2026-01-05T00:00:00Z' })] as never);
    const ctx = await context();
    const result = ctx.valueHolding({ holding, asOf: new Date('2026-01-03T10:00:00Z'), currencyCode: 'EUR' });
    expect(result.valuation.status).toBe('missing_fx');
    expect(result.valuation.spotValue).toBeNull();
    expect(result.valuation.unrealizedGain).toBeNull();
    expect(result.valuation.costBasisComplete).toBe(false);
  });

  it('keeps gains unknown with an unknown opening basis despite an available price', async () => {
    jest.mocked(MetalQuotes.findAll).mockResolvedValue([quote()] as never);
    const ctx = await context({ events: [event({ totalAmount: null })] });
    const result = ctx.valueHolding({ holding, asOf: new Date('2026-01-03T00:00:00Z') });
    expect(result.valuation.spotValue).toBe(150);
    expect(result.valuation.unrealizedGain).toBeNull();
    expect(result.valuation.costBasisComplete).toBe(false);
  });

  it('values empty inventory as zero without requiring a market quote', async () => {
    const ctx = await context({ events: [] });
    const result = ctx.valueHolding({ holding, asOf: new Date('2026-01-03T00:00:00Z') });
    expect(result.valuation.status).toBe('empty');
    expect(result.valuation.spotValue).toBe(0);
    expect(result.valuation.unrealizedGain).toBe(0);
  });

  it('preloads once for a historical series without querying for every point', async () => {
    jest.mocked(MetalQuotes.findAll).mockResolvedValue([quote()] as never);
    const ctx = await context();
    for (let day = 1; day <= 10; day += 1) {
      ctx.valueHolding({ holding, asOf: new Date(`2026-01-${String(day).padStart(2, '0')}T12:00:00Z`) });
    }
    expect(MetalQuotes.findAll).toHaveBeenCalledTimes(1);
    expect(ExchangeRates.findAll).toHaveBeenCalledTimes(1);
    expect(UserExchangeRates.findAll).not.toHaveBeenCalled();
  });
});
