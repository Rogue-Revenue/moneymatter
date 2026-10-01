import { PRECIOUS_METALS, type MetalHoldingDto, type MetalValuationDto } from '@bt/shared/types/precious-metals';
import Big from 'big.js';

type HoldingWeight = Pick<MetalHoldingDto, 'metal'> & {
  valuation: Pick<MetalValuationDto, 'quantity' | 'fineGrams' | 'fineTroyOunces'>;
};

export const sumMetalWeights = ({ holdings }: { holdings: HoldingWeight[] }) =>
  PRECIOUS_METALS.map((metal) => {
    let grams = new Big(0);
    let ounces = new Big(0);
    for (const holding of holdings) {
      if (holding.metal !== metal || new Big(holding.valuation.quantity).eq(0)) continue;
      grams = grams.plus(holding.valuation.fineGrams);
      ounces = ounces.plus(holding.valuation.fineTroyOunces);
    }
    return { metal, fineGrams: grams.toFixed(), fineTroyOunces: ounces.toFixed() };
  });
