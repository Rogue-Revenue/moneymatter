import type { RecordId } from '@bt/shared/types';
import type { MetalEventType, MetalPhysicalSpec } from '@bt/shared/types/precious-metals';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import Big from 'big.js';

export const GRAMS_PER_TROY_OUNCE = '31.1034768';

export interface MetalInventoryEvent {
  id: RecordId;
  type: MetalEventType;
  date: string;
  quantity: string;
  fineGramsPerItem: string;
  totalAmount: Money | null;
  createdAt: Date | string;
}

interface MetalInventoryLot {
  eventId: RecordId;
  date: string;
  quantity: string;
  remainingQuantity: string;
  fineGramsPerItem: string;
  originalCost: Money | null;
  remainingCost: Money | null;
}

interface MetalInventorySale {
  costBasis: Money | null;
  realizedGain: Money | null;
  allocations: { eventId: RecordId; quantity: string; costBasis: Money | null }[];
}

interface MetalInventory {
  quantity: string;
  fineGrams: string;
  lots: MetalInventoryLot[];
  knownCostBasis: Money;
  costBasisComplete: boolean;
  unknownCostQuantity: string;
  realizedGain: Money | null;
  sales: Map<RecordId, MetalInventorySale>;
}

const positiveDecimal = ({ value }: { value: string }): Big => {
  try {
    const decimal = new Big(value);
    if (decimal.gt(0)) return decimal;
  } catch {
    // Invalid decimal syntax uses the same validation response as a nonpositive amount.
  }
  throw new ValidationError({ message: t({ key: 'preciousMetals.invalidPhysicalSpec' }) });
};

export const computeFineGramsPerItem = ({
  weightPerItem,
  weightUnit,
  weightBasis,
  purity,
}: Pick<MetalPhysicalSpec, 'weightPerItem' | 'weightUnit' | 'weightBasis' | 'purity'>): string => {
  const weight = positiveDecimal({ value: weightPerItem });
  const fineness = positiveDecimal({ value: purity });
  if (fineness.gt(1) || !['g', 'troy_oz'].includes(weightUnit) || !['gross', 'fine'].includes(weightBasis)) {
    throw new ValidationError({ message: t({ key: 'preciousMetals.invalidPhysicalSpec' }) });
  }
  const grams = weightUnit === 'troy_oz' ? weight.times(GRAMS_PER_TROY_OUNCE) : weight;
  return (weightBasis === 'gross' ? grams.times(fineness) : grams).toFixed();
};

/** Rebuild FIFO inventory from effective event dates, preserving unknown acquisition costs. */
export const replayMetalInventory = ({
  events,
  asOf,
}: {
  events: readonly MetalInventoryEvent[];
  asOf?: Date | string;
}): MetalInventory => {
  const throughDay = asOf instanceof Date ? asOf.toISOString().slice(0, 10) : asOf?.slice(0, 10);
  const orderedEvents = events
    .filter((event) => !throughDay || event.date <= throughDay)
    .toSorted(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
        a.id.localeCompare(b.id),
    );
  const lots: MetalInventoryLot[] = [];
  const sales = new Map<RecordId, MetalInventorySale>();
  let quantity = new Big(0);
  let realizedGain: Money | null = Money.zero();
  let nextLot = 0;

  for (const event of orderedEvents) {
    const eventQuantity = positiveDecimal({ value: event.quantity });
    positiveDecimal({ value: event.fineGramsPerItem });
    if (event.type !== 'sale') {
      quantity = quantity.plus(eventQuantity);
      lots.push({
        eventId: event.id,
        date: event.date,
        quantity: eventQuantity.toFixed(),
        remainingQuantity: eventQuantity.toFixed(),
        fineGramsPerItem: event.fineGramsPerItem,
        originalCost: event.totalAmount,
        remainingCost: event.totalAmount,
      });
      continue;
    }

    if (eventQuantity.gt(quantity)) {
      throw new ValidationError({
        message: t({ key: 'preciousMetals.insufficientInventory' }),
        details: { eventId: event.id, date: event.date, availableQuantity: quantity.toFixed() },
      });
    }
    quantity = quantity.minus(eventQuantity);
    let toSell = eventQuantity;
    let costBasis: Money | null = Money.zero();
    const allocations: MetalInventorySale['allocations'] = [];

    while (toSell.gt(0)) {
      const lot = lots[nextLot]!;
      const remaining = new Big(lot.remainingQuantity);
      const taken = remaining.lte(toSell) ? remaining : toSell;
      // Assign the complete remainder on depletion so fractional sales conserve original cost.
      const allocatedCost =
        lot.remainingCost === null
          ? null
          : taken.eq(remaining)
            ? lot.remainingCost
            : lot.remainingCost.multiply(taken.toFixed()).divide(remaining.toFixed());
      allocations.push({ eventId: lot.eventId, quantity: taken.toFixed(), costBasis: allocatedCost });
      costBasis = costBasis !== null && allocatedCost !== null ? costBasis.add(allocatedCost) : null;
      lot.remainingCost =
        lot.remainingCost !== null && allocatedCost !== null ? lot.remainingCost.subtract(allocatedCost) : null;
      lot.remainingQuantity = remaining.minus(taken).toFixed();
      toSell = toSell.minus(taken);
      if (taken.eq(remaining)) nextLot += 1;
    }

    const gain = costBasis !== null && event.totalAmount !== null ? event.totalAmount.subtract(costBasis) : null;
    sales.set(event.id, { costBasis, realizedGain: gain, allocations });
    realizedGain = realizedGain !== null && gain !== null ? realizedGain.add(gain) : null;
  }

  let fineGrams = new Big(0);
  let knownCostBasis = Money.zero();
  let unknownCostQuantity = new Big(0);
  for (const lot of lots) {
    const remaining = new Big(lot.remainingQuantity);
    fineGrams = fineGrams.plus(remaining.times(lot.fineGramsPerItem));
    if (lot.remainingCost === null) unknownCostQuantity = unknownCostQuantity.plus(remaining);
    else knownCostBasis = knownCostBasis.add(lot.remainingCost);
  }

  return {
    quantity: quantity.toFixed(),
    fineGrams: fineGrams.toFixed(),
    lots,
    knownCostBasis,
    costBasisComplete: unknownCostQuantity.eq(0),
    unknownCostQuantity: unknownCostQuantity.toFixed(),
    realizedGain,
    sales,
  };
};
