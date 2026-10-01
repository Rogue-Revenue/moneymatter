import { describe, expect, it } from 'vitest';

import { sumMetalWeights } from './overview-totals';

describe('overview fine metal totals', () => {
  it('adds high precision holdings within each metal and ignores closed quantities', () => {
    expect(
      sumMetalWeights({
        holdings: [
          { metal: 'gold', valuation: { quantity: '1', fineGrams: '31.1034768', fineTroyOunces: '1' } },
          { metal: 'gold', valuation: { quantity: '0.25', fineGrams: '7.7758692', fineTroyOunces: '0.25' } },
          { metal: 'silver', valuation: { quantity: '0.1', fineGrams: '3.11034768', fineTroyOunces: '0.1' } },
          { metal: 'silver', valuation: { quantity: '0.2', fineGrams: '6.22069536', fineTroyOunces: '0.2' } },
          { metal: 'gold', valuation: { quantity: '0', fineGrams: '100', fineTroyOunces: '10' } },
          { metal: 'platinum', valuation: { quantity: '0.5', fineGrams: '15.5517384', fineTroyOunces: '0.5' } },
          { metal: 'platinum', valuation: { quantity: '0.25', fineGrams: '7.7758692', fineTroyOunces: '0.25' } },
          { metal: 'platinum', valuation: { quantity: '0', fineGrams: '100', fineTroyOunces: '10' } },
        ],
      }),
    ).toEqual([
      { metal: 'gold', fineGrams: '38.879346', fineTroyOunces: '1.25' },
      { metal: 'silver', fineGrams: '9.33104304', fineTroyOunces: '0.3' },
      { metal: 'platinum', fineGrams: '23.3276076', fineTroyOunces: '0.75' },
    ]);
  });

  it('returns zero totals for an empty collection', () => {
    expect(sumMetalWeights({ holdings: [] })).toEqual([
      { metal: 'gold', fineGrams: '0', fineTroyOunces: '0' },
      { metal: 'silver', fineGrams: '0', fineTroyOunces: '0' },
      { metal: 'platinum', fineGrams: '0', fineTroyOunces: '0' },
    ]);
  });
});
