import { asCents, type Cents } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { UnexpectedError } from '@js/errors';
import PreciousMetalEvents from '@models/precious-metals/events.model';
import PreciousMetalHoldings from '@models/precious-metals/holdings.model';
import UsersCurrencies from '@models/users-currencies.model';
import Big from 'big.js';
import { Op } from 'sequelize';

import { createMetalValuationContext } from './valuation';

interface MetalsHistoryPoint {
  /** Known market values only; missing holdings are counted separately. */
  value: Cents;
  unvaluedMetalsCount: number;
  staleMetalsCount: number;
}

export const calculateMetalsBalanceHistory = async ({
  userId,
  maxDate,
  uniqueDates,
  userBaseCurrencyPromise,
}: {
  userId: number;
  maxDate: string;
  uniqueDates: string[];
  userBaseCurrencyPromise: Promise<Pick<UsersCurrencies, 'currencyCode'> | null>;
}): Promise<Map<string, MetalsHistoryPoint> | null> => {
  const [holdings, baseCurrency] = await Promise.all([
    PreciousMetalHoldings.findAll({ where: { userId } }),
    userBaseCurrencyPromise,
  ]);
  if (holdings.length === 0) return null;
  if (!baseCurrency) {
    throw new UnexpectedError({ message: t({ key: 'currencies.cannotFindForRefAmount' }) });
  }

  const through = new Date(`${maxDate}T23:59:59.999Z`);
  const events = await PreciousMetalEvents.findAll({
    where: { userId, holdingId: { [Op.in]: holdings.map((holding) => holding.id) }, date: { [Op.lte]: maxDate } },
    order: [
      ['date', 'ASC'],
      ['createdAt', 'ASC'],
      ['id', 'ASC'],
    ],
  });
  const context = await createMetalValuationContext({
    userId,
    holdings,
    events,
    through,
    targetCurrencyCodes: [baseCurrency.currencyCode],
  });

  return new Map(
    uniqueDates.map<[string, MetalsHistoryPoint]>((date) => {
      const asOf = new Date(`${date}T23:59:59.999Z`);
      let total = Money.zero();
      let unvaluedMetalsCount = 0;
      let staleMetalsCount = 0;

      for (const holding of holdings) {
        const { valuation } = context.valueHolding({ holding, asOf, currencyCode: baseCurrency.currencyCode });
        if (!new Big(valuation.quantity).gt(0)) continue;
        if (valuation.spotValue === null) unvaluedMetalsCount += 1;
        else total = total.add(Money.fromDecimal(valuation.spotValue));
        if (valuation.quote?.isStale) staleMetalsCount += 1;
      }

      return [date, { value: asCents(total.toCents()), unvaluedMetalsCount, staleMetalsCount }];
    }),
  );
};
