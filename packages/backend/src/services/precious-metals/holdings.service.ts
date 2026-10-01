import type { RecordId } from '@bt/shared/types';
import type {
  CreateMetalEventInput,
  CreateMetalHoldingInput,
  CreateMetalQuoteInput,
  MetalHoldingDetailDto,
  MetalHoldingDto,
  MetalQuoteDto,
  MetalsOverviewDto,
  UpdateMetalHoldingInput,
} from '@bt/shared/types/precious-metals';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { NotFoundError, ValidationError } from '@js/errors';
import { namespace } from '@models/connection';
import PreciousMetalEvents from '@models/precious-metals/events.model';
import PreciousMetalHoldings from '@models/precious-metals/holdings.model';
import PreciousMetalQuotes from '@models/precious-metals/quotes.model';
import { withTransaction } from '@services/common/with-transaction';
import { Op } from 'sequelize';

import { computeFineGramsPerItem, replayMetalInventory } from './inventory';
import { linkMetalEvent, unlinkMetalEvent } from './linking';
import { getMetalProviderInfo } from './pricing/provider';
import { createMetalValuationContext } from './valuation';

const requireMetalHolding = async ({
  userId,
  holdingId,
  lock = false,
}: {
  userId: number;
  holdingId: RecordId;
  lock?: boolean;
}) => {
  const holding = await PreciousMetalHoldings.findOne({
    where: { id: holdingId, userId },
    ...(lock ? { lock: true, transaction: namespace.get('transaction') } : {}),
  });
  if (!holding) throw new NotFoundError({ message: t({ key: 'preciousMetals.holdingNotFound' }) });
  return holding;
};

const serializeHolding = ({
  holding,
  valuation,
}: {
  holding: PreciousMetalHoldings;
  valuation: MetalHoldingDto['valuation'];
}): MetalHoldingDto => ({
  id: holding.id,
  name: holding.name,
  metal: holding.metal,
  form: holding.form,
  weightPerItem: holding.weightPerItem,
  weightUnit: holding.weightUnit,
  weightBasis: holding.weightBasis,
  purity: holding.purity,
  currencyCode: holding.currencyCode,
  storageNotes: holding.storageNotes,
  pricingMode: holding.pricingMode,
  createdAt: holding.createdAt.toISOString(),
  valuation,
});

const serializeMetalQuote = ({
  quote,
  now = new Date(),
}: {
  quote: PreciousMetalQuotes;
  now?: Date;
}): MetalQuoteDto => ({
  id: quote.id,
  metal: quote.metal,
  pricePerTroyOz: quote.pricePerTroyOz.toNumber(),
  currencyCode: quote.currencyCode,
  asOf: quote.asOf.toISOString(),
  retrievedAt: quote.retrievedAt.toISOString(),
  source: quote.source,
  isManual: quote.holdingId !== null,
  isStale: now.getTime() - quote.asOf.getTime() > 72 * 60 * 60 * 1000,
});

export const getMetalHolding = async ({
  userId,
  holdingId,
}: {
  userId: number;
  holdingId: RecordId;
}): Promise<MetalHoldingDetailDto> => {
  const holding = await requireMetalHolding({ userId, holdingId });
  const events = await PreciousMetalEvents.findAll({
    where: { userId, holdingId },
    order: [
      ['date', 'ASC'],
      ['createdAt', 'ASC'],
      ['id', 'ASC'],
    ],
  });
  const now = new Date();
  const context = await createMetalValuationContext({
    userId,
    holdings: [holding],
    events,
    through: now,
    targetCurrencyCodes: [],
  });
  const result = context.valueHolding({ holding, asOf: now });
  const quotes = await PreciousMetalQuotes.findAll({
    where: {
      metal: holding.metal,
      [Op.or]: [
        { userId, holdingId },
        { userId: null, holdingId: null },
      ],
    },
    order: [['asOf', 'DESC']],
    limit: 50,
  });
  return {
    ...serializeHolding({ holding, valuation: result.valuation }),
    lots: result.lots,
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      date: event.date,
      quantity: event.quantity,
      totalAmount: event.totalAmount?.toNumber() ?? null,
      currencyCode: event.currencyCode,
      notes: event.notes,
      transactionId: event.transactionId,
      costBasis: result.sales.get(event.id)?.costBasis ?? null,
      realizedGain: result.sales.get(event.id)?.realizedGain ?? null,
      createdAt: event.createdAt.toISOString(),
    })),
    quotes: quotes.map((quote) => serializeMetalQuote({ quote, now })),
  };
};

export const listMetalHoldings = async ({ userId }: { userId: number }): Promise<MetalsOverviewDto> => {
  const holdings = await PreciousMetalHoldings.findAll({ where: { userId }, order: [['createdAt', 'DESC']] });
  if (holdings.length === 0) return { holdings: [], provider: getMetalProviderInfo({}) };
  const events = holdings.length
    ? await PreciousMetalEvents.findAll({
        where: { userId, holdingId: { [Op.in]: holdings.map((holding) => holding.id) } },
      })
    : [];
  const now = new Date();
  const context = await createMetalValuationContext({
    userId,
    holdings,
    events,
    through: now,
    targetCurrencyCodes: [],
  });
  return {
    holdings: holdings.map((holding) =>
      serializeHolding({ holding, valuation: context.valueHolding({ holding, asOf: now }).valuation }),
    ),
    provider: getMetalProviderInfo({}),
  };
};

export const createMetalHolding = withTransaction(
  async ({ userId, input }: { userId: number; input: CreateMetalHoldingInput }) => {
    computeFineGramsPerItem(input);
    const { openingLot, ...physical } = input;
    const pricingMode = input.pricingMode ?? 'automatic';
    const holding = await PreciousMetalHoldings.create({
      ...physical,
      userId,
      storageNotes: input.storageNotes ?? null,
      pricingMode,
      pricingModeHistory: [{ mode: pricingMode, effectiveAt: '0001-01-01T00:00:00.000Z' }],
    });
    if (openingLot)
      await createMetalEvent({ userId, holdingId: holding.id, input: { ...openingLot, type: 'opening' } });
    return getMetalHolding({ userId, holdingId: holding.id });
  },
);

export const updateMetalHolding = withTransaction(
  async ({ userId, holdingId, input }: { userId: number; holdingId: RecordId; input: UpdateMetalHoldingInput }) => {
    const holding = await requireMetalHolding({ userId, holdingId, lock: true });
    const history =
      input.pricingMode && input.pricingMode !== holding.pricingMode
        ? [...holding.pricingModeHistory, { mode: input.pricingMode, effectiveAt: new Date().toISOString() }]
        : holding.pricingModeHistory;
    await holding.update({ ...input, pricingModeHistory: history });
    return getMetalHolding({ userId, holdingId });
  },
);

export const createMetalEvent = withTransaction(
  async ({ userId, holdingId, input }: { userId: number; holdingId: RecordId; input: CreateMetalEventInput }) => {
    const holding = await requireMetalHolding({ userId, holdingId, lock: true });
    if (input.type === 'opening' && input.transactionId)
      throw new ValidationError({ message: t({ key: 'preciousMetals.openingCannotLink' }) });
    const event = await PreciousMetalEvents.create({
      userId,
      holdingId,
      type: input.type,
      date: input.date,
      quantity: input.quantity,
      fineGramsPerItem: computeFineGramsPerItem(holding),
      totalAmount: input.totalAmount === null ? null : Money.fromDecimal(input.totalAmount),
      currencyCode: holding.currencyCode,
      notes: input.notes ?? null,
      transactionId: null,
      originalTransactionState: null,
    });
    // Replay the whole timeline: a backdated sale must also leave later sales covered.
    const events = await PreciousMetalEvents.findAll({ where: { userId, holdingId } });
    replayMetalInventory({ events });
    if (input.transactionId)
      await linkMetalEvent({ userId, holdingId, eventId: event.id, transactionId: input.transactionId });
    return getMetalHolding({ userId, holdingId });
  },
);

export const deleteMetalEvent = withTransaction(
  async ({ userId, holdingId, eventId }: { userId: number; holdingId: RecordId; eventId: RecordId }) => {
    await requireMetalHolding({ userId, holdingId, lock: true });
    const event = await PreciousMetalEvents.findOne({ where: { id: eventId, userId, holdingId } });
    if (!event) throw new NotFoundError({ message: t({ key: 'preciousMetals.eventNotFound' }) });
    const events = await PreciousMetalEvents.findAll({ where: { userId, holdingId } });
    replayMetalInventory({ events: events.filter((item) => item.id !== eventId) });
    if (event.transactionId) await unlinkMetalEvent({ userId, holdingId, eventId });
    await event.destroy();
    return { success: true };
  },
);

export const createMetalQuote = withTransaction(
  async ({ userId, holdingId, input }: { userId: number; holdingId: RecordId; input: CreateMetalQuoteInput }) => {
    const holding = await requireMetalHolding({ userId, holdingId, lock: true });
    const asOf = new Date(input.asOf);
    await PreciousMetalQuotes.create({
      userId,
      holdingId,
      metal: holding.metal,
      currencyCode: input.currencyCode,
      pricePerTroyOz: Money.fromDecimal(input.pricePerTroyOz),
      asOf,
      retrievedAt: new Date(),
      source: 'manual',
    });
    // Manual observations can be dated explicitly; automatic quotes never backfill earlier dates.
    const history = [...holding.pricingModeHistory, { mode: 'manual' as const, effectiveAt: asOf.toISOString() }].sort(
      (a, b) => a.effectiveAt.localeCompare(b.effectiveAt),
    );
    await holding.update({ pricingModeHistory: history, pricingMode: history.at(-1)!.mode });
    return getMetalHolding({ userId, holdingId });
  },
);
