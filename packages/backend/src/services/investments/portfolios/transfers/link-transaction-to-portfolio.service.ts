import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import Currencies from '@models/currencies.model';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import Portfolios from '@models/investments/portfolios.model';
import { findOneTransaction } from '@models/transactions-query';
import * as Transactions from '@models/transactions.model';
import { assertNotAlreadyLinked } from '@services/common/transaction-linking';
import { withTransaction } from '@services/common/with-transaction';
import { updatePortfolioBalance } from '@services/investments/portfolios/balances';
import { format } from 'date-fns';

import { computeRestampForExistingTransaction, findPortfolioOrThrow, negateAmount } from './transfer-validations';

interface LinkTransactionToPortfolioParams {
  userId: number;
  transactionId: string;
  portfolioId: string;
  affectsCash?: boolean;
}

const linkTransactionToPortfolioImpl = async ({
  userId,
  transactionId,
  portfolioId,
  affectsCash = true,
}: LinkTransactionToPortfolioParams) => {
  const tx = await findOrThrowNotFound({
    query: findOneTransaction({
      planned: 'include',
      access: { creator: userId },
      balanceAdjustments: 'include',
      where: { id: transactionId },
      lock: true,
    }),
    message: t({ key: 'transactions.notFound' }),
  });

  await assertNotAlreadyLinked({ tx });

  await findPortfolioOrThrow({ portfolioId, userId, role: 'generic' });

  const amount = tx.amount.toDecimalString(10);
  const date = format(tx.time, 'yyyy-MM-dd');
  const currencyCode = tx.currencyCode;

  const { refCurrencyCode, refAmount } = await computeRestampForExistingTransaction({ tx, userId });

  // expense → money flows from account to portfolio (portfolio balance UP)
  // income → money flows from portfolio to account (portfolio balance DOWN)
  const isExpense = tx.transactionType === TRANSACTION_TYPES.expense;

  const transfer = await PortfolioTransfers.create({
    userId,
    fromAccountId: isExpense ? tx.accountId : null,
    toPortfolioId: isExpense ? portfolioId : null,
    fromPortfolioId: isExpense ? null : portfolioId,
    toAccountId: isExpense ? null : tx.accountId,
    amount,
    refAmount,
    currencyCode,
    date,
    transactionId,
    affectsCash,
    metaData: {
      originalTransactionState: {
        transferNature: tx.transferNature,
        transferId: tx.transferId,
        categoryId: tx.categoryId,
        amount: tx.amount.toCents(),
        refAmount: tx.refAmount.toCents(),
        accountId: tx.accountId,
        transactionType: tx.transactionType,
        paymentType: tx.paymentType,
        currencyCode: tx.currencyCode,
        time: tx.time,
        note: tx.note,
      },
    },
  });

  await Transactions.updateTransactionById({
    id: transactionId,
    userId,
    transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio,
    refCurrencyCode,
    refAmount,
  });

  if (affectsCash) {
    const delta = isExpense ? amount : negateAmount({ amount });

    await updatePortfolioBalance({
      userId,
      portfolioId,
      currencyCode,
      availableCashDelta: delta,
      totalCashDelta: delta,
    });
  }

  return transfer.reload({
    include: [
      { model: Portfolios, as: 'fromPortfolio' },
      { model: Portfolios, as: 'toPortfolio' },
      { model: Currencies, as: 'currency' },
    ],
  });
};

export const linkTransactionToPortfolio = withTransaction(linkTransactionToPortfolioImpl);
