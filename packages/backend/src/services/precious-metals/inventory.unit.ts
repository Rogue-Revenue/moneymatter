import type { RecordId } from '@bt/shared/types';
import { Money } from '@common/types/money';

import { computeFineGramsPerItem, replayMetalInventory, type MetalInventoryEvent } from './inventory';

const event = ({
  id,
  ...overrides
}: Omit<Partial<MetalInventoryEvent>, 'id'> & { id: string }): MetalInventoryEvent => ({
  type: 'purchase',
  date: '2026-01-01',
  quantity: '1',
  fineGramsPerItem: '31.1034768',
  totalAmount: Money.fromDecimal('100'),
  createdAt: '2026-01-01T00:00:00Z',
  ...overrides,
  id: id as RecordId,
});

describe('physical metal mass', () => {
  it('uses the exact troy ounce conversion and applies gross purity once', () => {
    expect(
      computeFineGramsPerItem({ weightPerItem: '1', weightUnit: 'troy_oz', weightBasis: 'gross', purity: '0.999' }),
    ).toBe('31.0723733232');
  });

  it('does not discount a declared fine weight by purity', () => {
    expect(
      computeFineGramsPerItem({ weightPerItem: '1', weightUnit: 'troy_oz', weightBasis: 'fine', purity: '0.9167' }),
    ).toBe('31.1034768');
    expect(
      computeFineGramsPerItem({ weightPerItem: '10.01', weightUnit: 'g', weightBasis: 'gross', purity: '0.925' }),
    ).toBe('9.25925');
  });

  it.each(['0', '-1', '1.01'])('rejects an invalid purity %s', (purity) => {
    expect(() =>
      computeFineGramsPerItem({ weightPerItem: '1', weightUnit: 'g', weightBasis: 'fine', purity }),
    ).toThrow();
  });
});

describe('physical metal FIFO ledger', () => {
  it('replays partial sales across purchase lots with all-in acquisition costs', () => {
    const result = replayMetalInventory({
      events: [
        event({ id: 'first', quantity: '2', totalAmount: Money.fromDecimal('210') }),
        event({ id: 'second', date: '2026-01-02', quantity: '1', totalAmount: Money.fromDecimal('140') }),
        event({ id: 'sale', date: '2026-01-03', type: 'sale', quantity: '2.5', totalAmount: Money.fromDecimal('350') }),
      ],
    });

    expect(result.quantity).toBe('0.5');
    expect(result.fineGrams).toBe('15.5517384');
    expect(result.knownCostBasis.toString()).toBe('70');
    expect(result.costBasisComplete).toBe(true);
    expect(result.sales.get('sale' as RecordId)?.costBasis?.toString()).toBe('280');
    expect(result.realizedGain?.toString()).toBe('70');
    expect(result.lots.map((lot) => lot.remainingQuantity)).toEqual(['0', '0.5']);
  });

  it('retains unknown cost separately and propagates it to gains', () => {
    const result = replayMetalInventory({
      events: [
        event({ id: 'unknown', type: 'opening', quantity: '2', totalAmount: null }),
        event({ id: 'known', date: '2026-01-02', quantity: '2', totalAmount: Money.fromDecimal('200') }),
        event({ id: 'sale', date: '2026-01-03', type: 'sale', quantity: '1', totalAmount: Money.fromDecimal('120') }),
      ],
    });

    expect(result.quantity).toBe('3');
    expect(result.knownCostBasis.toString()).toBe('200');
    expect(result.unknownCostQuantity).toBe('1');
    expect(result.costBasisComplete).toBe(false);
    expect(result.sales.get('sale' as RecordId)?.costBasis).toBeNull();
    expect(result.realizedGain).toBeNull();
  });

  it('keeps remaining basis known once all unknown lots are sold', () => {
    const result = replayMetalInventory({
      events: [
        event({ id: 'unknown', type: 'opening', totalAmount: null }),
        event({ id: 'known', date: '2026-01-02' }),
        event({ id: 'sale', date: '2026-01-03', type: 'sale' }),
      ],
    });
    expect(result.costBasisComplete).toBe(true);
    expect(result.unknownCostQuantity).toBe('0');
    expect(result.realizedGain).toBeNull();
  });

  it('allocates the final remainder so repeated fractional sales conserve every cost decimal', () => {
    const result = replayMetalInventory({
      events: [
        event({ id: 'purchase', quantity: '3', totalAmount: Money.fromDecimal('1') }),
        ...['2026-01-02', '2026-01-03', '2026-01-04'].map((date, index) =>
          event({ id: `sale-${index}`, type: 'sale', date, totalAmount: Money.fromDecimal('1') }),
        ),
      ],
    });

    const allocated = Money.sum([...result.sales.values()].map((sale) => sale.costBasis!));
    expect(allocated.toString()).toBe('1');
    expect(result.knownCostBasis.toString()).toBe('0');
    expect(result.quantity).toBe('0');
    expect(result.realizedGain?.toString()).toBe('2');
  });

  it('rejects a backdated sale even when a later purchase makes the final balance positive', () => {
    expect(() =>
      replayMetalInventory({
        events: [event({ id: 'sale', type: 'sale', date: '2025-12-31' }), event({ id: 'purchase', quantity: '5' })],
      }),
    ).toThrow();
  });

  it('orders equal-date events by creation time and id without mutating the input', () => {
    const events = [
      event({ id: 'c', type: 'sale', createdAt: '2026-01-01T02:00:00Z' }),
      event({ id: 'b', totalAmount: Money.fromDecimal('200') }),
      event({ id: 'a', totalAmount: Money.fromDecimal('100') }),
    ];
    const result = replayMetalInventory({ events });
    expect(result.sales.get('c' as RecordId)?.costBasis?.toString()).toBe('100');
    expect(events.map(({ id }) => id)).toEqual(['c', 'b', 'a']);
  });

  it('only replays activity on or before the requested day', () => {
    const result = replayMetalInventory({
      asOf: new Date('2026-01-01T12:00:00Z'),
      events: [event({ id: 'first' }), event({ id: 'future', date: '2026-01-02' })],
    });
    expect(result.quantity).toBe('1');
  });
});
