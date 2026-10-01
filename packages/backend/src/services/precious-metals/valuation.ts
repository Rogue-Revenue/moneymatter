import type { RecordId } from '@bt/shared/types';
import type {
  MetalLotDto,
  MetalPricingMode,
  MetalPricingModeChange,
  MetalQuoteDto,
  MetalValuationDto,
  PreciousMetal,
} from '@bt/shared/types/precious-metals';
import { Money } from '@common/types/money';
import ExchangeRates from '@models/exchange-rates.model';
import MetalQuotes from '@models/precious-metals/quotes.model';
import Big from 'big.js';
import { Op } from 'sequelize';

import { GRAMS_PER_TROY_OUNCE, replayMetalInventory, type MetalInventoryEvent } from './inventory';

export interface MetalValuationHolding {
  id: RecordId;
  userId: number;
  metal: PreciousMetal;
  currencyCode: string;
  pricingMode: MetalPricingMode;
  pricingModeHistory: MetalPricingModeChange[];
}

export interface MetalValuationEvent extends MetalInventoryEvent {
  holdingId: RecordId;
  userId: number;
  currencyCode: string;
}

interface HistoricalQuote {
  id: RecordId;
  userId: number | null;
  holdingId: RecordId | null;
  metal: PreciousMetal;
  currencyCode: string;
  pricePerTroyOz: Money;
  asOf: Date;
  retrievedAt: Date;
  source: string;
}

interface DatedRate {
  timestamp: number;
  rate: string;
}
interface DatedQuote {
  timestamp: number;
  quote: HistoricalQuote;
}
interface DatedMode {
  timestamp: number;
  mode: MetalPricingMode;
}

interface MetalHoldingValuation {
  valuation: MetalValuationDto;
  lots: MetalLotDto[];
  sales: Map<RecordId, { costBasis: number | null; realizedGain: number | null }>;
}

const STALE_AFTER_MS = 72 * 60 * 60 * 1000;

const latestAt = <T extends { timestamp: number }>({ rows, timestamp }: { rows: T[]; timestamp: number }): T | null => {
  let low = 0;
  let high = rows.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (rows[middle]!.timestamp <= timestamp) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found === -1 ? null : rows[found]!;
};

/** Preload dated observations once; each historical valuation performs no database queries. */
export const createMetalValuationContext = async ({
  userId,
  holdings,
  events,
  through,
  targetCurrencyCodes,
}: {
  userId: number;
  holdings: readonly MetalValuationHolding[];
  events: readonly MetalValuationEvent[];
  through: Date;
  /** Restrict FX preload when all requested output currencies are known by the caller. */
  targetCurrencyCodes?: readonly string[];
}): Promise<{
  valueHolding: (params: {
    holding: MetalValuationHolding;
    asOf: Date;
    currencyCode?: string;
  }) => MetalHoldingValuation;
}> => {
  const ownedHoldings = holdings.filter((holding) => holding.userId === userId);
  const holdingIds = ownedHoldings.map(({ id }) => id);
  const ids = new Set(holdingIds);
  const quotes: HistoricalQuote[] = await MetalQuotes.findAll({
    where: {
      asOf: { [Op.lte]: through },
      [Op.or]: [
        { userId: null, holdingId: null },
        { userId, holdingId: { [Op.in]: holdingIds } },
      ],
    },
    order: [
      ['asOf', 'ASC'],
      ['retrievedAt', 'ASC'],
      ['id', 'ASC'],
    ],
  });
  const currencies = targetCurrencyCodes
    ? [
        ...new Set([
          ...targetCurrencyCodes,
          ...ownedHoldings.map(({ currencyCode }) => currencyCode),
          ...quotes.map(({ currencyCode }) => currencyCode),
        ]),
      ]
    : undefined;
  // User overrides are mutable preferences; dated system observations support reproducible history.
  const systemRates = await ExchangeRates.findAll({
    where: {
      baseCode: 'USD',
      date: { [Op.lte]: through },
      ...(currencies ? { quoteCode: { [Op.in]: currencies } } : {}),
    },
    order: [['date', 'ASC']],
  });

  const usdRates = new Map<string, DatedRate[]>();
  for (const row of systemRates) {
    if (row.baseCode !== 'USD' || !Number.isFinite(row.rate) || row.rate <= 0) continue;
    const rows = usdRates.get(row.quoteCode) ?? [];
    rows.push({ timestamp: new Date(row.date).getTime(), rate: String(row.rate) });
    usdRates.set(row.quoteCode, rows);
  }
  for (const rows of usdRates.values()) rows.sort((a, b) => a.timestamp - b.timestamp);

  const rateAt = ({ from, to, timestamp }: { from: string; to: string; timestamp: number }): string | null => {
    if (from === to) return '1';
    const fromUsd = from === 'USD' ? '1' : latestAt({ rows: usdRates.get(from) ?? [], timestamp })?.rate;
    const toUsd = to === 'USD' ? '1' : latestAt({ rows: usdRates.get(to) ?? [], timestamp })?.rate;
    if (!fromUsd || !toUsd) return null;
    return new Big(toUsd).div(fromUsd).toFixed();
  };

  const providerQuotes = new Map<PreciousMetal, DatedQuote[]>();
  const manualQuotes = new Map<RecordId, DatedQuote[]>();
  for (const quote of quotes) {
    if (!quote.pricePerTroyOz.isPositive()) continue;
    const point = { timestamp: new Date(quote.asOf).getTime(), quote };
    if (quote.userId === null && quote.holdingId === null) {
      const rows = providerQuotes.get(quote.metal) ?? [];
      rows.push(point);
      providerQuotes.set(quote.metal, rows);
    } else if (quote.userId === userId && quote.holdingId !== null && ids.has(quote.holdingId)) {
      const rows = manualQuotes.get(quote.holdingId) ?? [];
      rows.push(point);
      manualQuotes.set(quote.holdingId, rows);
    }
  }
  for (const rows of [...providerQuotes.values(), ...manualQuotes.values()]) {
    rows.sort(
      (a, b) =>
        a.timestamp - b.timestamp ||
        new Date(a.quote.retrievedAt).getTime() - new Date(b.quote.retrievedAt).getTime() ||
        a.quote.id.localeCompare(b.quote.id),
    );
  }
  const holdingEvents = new Map<RecordId, MetalValuationEvent[]>();
  for (const event of events) {
    if (event.userId !== userId || !ids.has(event.holdingId)) continue;
    const rows = holdingEvents.get(event.holdingId) ?? [];
    rows.push(event);
    holdingEvents.set(event.holdingId, rows);
  }
  const modeHistories = new Map<RecordId, DatedMode[]>();
  for (const holding of ownedHoldings) {
    modeHistories.set(
      holding.id,
      holding.pricingModeHistory
        .map(({ mode, effectiveAt }) => ({ mode, timestamp: new Date(effectiveAt).getTime() }))
        .toSorted((a, b) => a.timestamp - b.timestamp),
    );
  }

  const valueHolding = ({
    holding,
    asOf,
    currencyCode = holding.currencyCode,
  }: {
    holding: MetalValuationHolding;
    asOf: Date;
    currencyCode?: string;
  }): MetalHoldingValuation => {
    if (holding.userId !== userId || !ids.has(holding.id))
      throw new Error('Holding does not belong to this valuation context');
    if (asOf.getTime() > through.getTime()) throw new Error('Valuation date exceeds the preloaded history');
    const day = asOf.toISOString().slice(0, 10);
    let missingFx = false;
    const convertedEvents = (holdingEvents.get(holding.id) ?? [])
      .filter((event) => event.date <= day)
      .map((event) => {
        if (event.totalAmount === null || event.totalAmount.isZero() || event.currencyCode === currencyCode)
          return event;
        const timestamp = Math.min(new Date(`${event.date}T23:59:59.999Z`).getTime(), asOf.getTime());
        const rate = rateAt({ from: event.currencyCode, to: currencyCode, timestamp });
        if (rate === null) missingFx = true;
        // Sequelize attributes are prototype getters, so explicitly copy the replay fields.
        return {
          id: event.id,
          type: event.type,
          date: event.date,
          createdAt: event.createdAt,
          quantity: event.quantity,
          fineGramsPerItem: event.fineGramsPerItem,
          totalAmount: rate === null ? null : event.totalAmount.multiply(rate),
        };
      });
    const inventory = replayMetalInventory({ events: convertedEvents, asOf });
    const modeHistory = modeHistories.get(holding.id) ?? [];
    const mode =
      latestAt({ rows: modeHistory, timestamp: asOf.getTime() })?.mode ?? modeHistory[0]?.mode ?? holding.pricingMode;
    const observation = latestAt({
      rows: mode === 'manual' ? (manualQuotes.get(holding.id) ?? []) : (providerQuotes.get(holding.metal) ?? []),
      timestamp: asOf.getTime(),
    });
    const quote = observation?.quote;
    const quoteDto: MetalQuoteDto | null = quote
      ? {
          id: quote.id,
          metal: quote.metal,
          pricePerTroyOz: quote.pricePerTroyOz.toNumber(),
          currencyCode: quote.currencyCode,
          asOf: new Date(quote.asOf).toISOString(),
          retrievedAt: new Date(quote.retrievedAt).toISOString(),
          source: quote.source,
          isManual: quote.holdingId !== null,
          isStale: asOf.getTime() - new Date(quote.asOf).getTime() > STALE_AFTER_MS,
        }
      : null;
    const isEmpty = new Big(inventory.quantity).eq(0);
    let spotValue: Money | null = isEmpty ? Money.zero() : null;
    if (!isEmpty && quote) {
      const rate = rateAt({ from: quote.currencyCode, to: currencyCode, timestamp: asOf.getTime() });
      if (rate === null) missingFx = true;
      else spotValue = quote.pricePerTroyOz.multiply(inventory.fineGrams).divide(GRAMS_PER_TROY_OUNCE).multiply(rate);
    }
    const status: MetalValuationDto['status'] = isEmpty
      ? 'empty'
      : !quote
        ? 'missing_price'
        : missingFx
          ? 'missing_fx'
          : quoteDto!.isStale
            ? 'stale'
            : 'current';
    return {
      valuation: {
        quantity: inventory.quantity,
        fineGrams: inventory.fineGrams,
        fineTroyOunces: new Big(inventory.fineGrams).div(GRAMS_PER_TROY_OUNCE).toFixed(),
        knownCostBasis: inventory.knownCostBasis.toNumber(),
        costBasisComplete: inventory.costBasisComplete,
        unknownCostQuantity: inventory.unknownCostQuantity,
        spotValue: spotValue?.toNumber() ?? null,
        unrealizedGain:
          spotValue !== null && inventory.costBasisComplete
            ? spotValue.subtract(inventory.knownCostBasis).toNumber()
            : null,
        realizedGain: inventory.realizedGain?.toNumber() ?? null,
        currencyCode,
        status,
        quote: quoteDto,
      },
      lots: inventory.lots.map((lot) => ({
        ...lot,
        originalCost: lot.originalCost?.toNumber() ?? null,
        remainingCost: lot.remainingCost?.toNumber() ?? null,
      })),
      sales: new Map(
        [...inventory.sales].map(([id, sale]) => [
          id,
          {
            costBasis: sale.costBasis?.toNumber() ?? null,
            realizedGain: sale.realizedGain?.toNumber() ?? null,
          },
        ]),
      ),
    };
  };
  return { valueHolding };
};
