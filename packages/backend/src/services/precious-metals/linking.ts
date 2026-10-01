import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import Accounts from '@models/accounts.model';
import BudgetTransactions from '@models/budget-transactions.model';
import PreciousMetalEvents from '@models/precious-metals/events.model';
import PreciousMetalHoldings from '@models/precious-metals/holdings.model';
import RefundTransactions from '@models/refund-transactions.model';
import TransactionSplits from '@models/transaction-splits.model';
import { findOneTransaction } from '@models/transactions-query';
import { hasSettledStatus } from '@services/bank-data-providers/enablebanking/utils/transaction-metadata';
import { assertNotAlreadyLinked, snapshotOriginalTransactionState } from '@services/common/transaction-linking';
import { withTransaction } from '@services/common/with-transaction';
import { Op } from 'sequelize';

interface MetalEventIdentity {
  userId: number;
  holdingId: string;
  eventId: string;
}

const lockEvent = async ({ userId, holdingId, eventId }: MetalEventIdentity) => {
  await findOrThrowNotFound({
    query: PreciousMetalHoldings.findOne({ where: { id: holdingId, userId }, lock: true }),
    message: t({ key: 'preciousMetals.holdingNotFound' }),
  });
  return findOrThrowNotFound({
    query: PreciousMetalEvents.findOne({ where: { id: eventId, holdingId, userId }, lock: true }),
    message: t({ key: 'preciousMetals.eventNotFound' }),
  });
};

export const linkMetalEvent = withTransaction(
  async ({
    userId,
    holdingId,
    eventId,
    transactionId,
  }: MetalEventIdentity & { transactionId: string }): Promise<void> => {
    const event = await lockEvent({ userId, holdingId, eventId });
    if (event.type === 'opening' || event.totalAmount === null) {
      throw new ValidationError({ message: t({ key: 'preciousMetals.eventCannotBeLinked' }) });
    }
    if (event.transactionId) {
      throw new ValidationError({ message: t({ key: 'preciousMetals.eventAlreadyLinked' }) });
    }

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
    await findOrThrowNotFound({
      query: Accounts.findOne({ where: { id: tx.accountId, userId }, attributes: ['id'] }),
      message: t({ key: 'transactions.notFound' }),
    });
    await assertNotAlreadyLinked({ tx });

    if (
      tx.transferNature !== TRANSACTION_TRANSFER_NATURE.not_transfer ||
      tx.isPlanned ||
      !hasSettledStatus({ tx }) ||
      tx.refundLinked ||
      tx.transferId ||
      tx.externalData?.balanceAdjustment
    ) {
      throw new ValidationError({ message: t({ key: 'preciousMetals.transactionNotEligible' }) });
    }
    const expectedDirection = event.type === 'purchase' ? TRANSACTION_TYPES.expense : TRANSACTION_TYPES.income;
    if (
      tx.transactionType !== expectedDirection ||
      tx.currencyCode !== event.currencyCode ||
      !tx.amount.equals(event.totalAmount)
    ) {
      throw new ValidationError({ message: t({ key: 'preciousMetals.transactionMustMatch' }) });
    }
    const [split, budget, refund] = await Promise.all([
      TransactionSplits.findOne({ where: { transactionId }, attributes: ['id'] }),
      BudgetTransactions.findOne({ where: { transactionId }, attributes: ['transactionId'] }),
      RefundTransactions.findOne({
        where: { [Op.or]: [{ originalTxId: transactionId }, { refundTxId: transactionId }] },
        attributes: ['id'],
      }),
    ]);
    if (split || budget || refund) {
      throw new ValidationError({ message: t({ key: 'preciousMetals.transactionNotEligible' }) });
    }

    await event.update({ transactionId: tx.id, originalTransactionState: snapshotOriginalTransactionState(tx) });
    // Classification changes leave the existing account balance and its historical FX stamps intact.
    await tx.update({ transferNature: TRANSACTION_TRANSFER_NATURE.transfer_to_precious_metals });
  },
);

export const unlinkMetalEvent = withTransaction(
  async ({ userId, holdingId, eventId }: MetalEventIdentity): Promise<void> => {
    const event = await lockEvent({ userId, holdingId, eventId });
    if (!event.transactionId) {
      if (event.originalTransactionState) await event.update({ originalTransactionState: null });
      return;
    }
    const snapshot = event.originalTransactionState;
    if (!snapshot) {
      throw new ValidationError({ message: t({ key: 'preciousMetals.linkSnapshotMissing' }) });
    }
    const tx = await findOrThrowNotFound({
      query: findOneTransaction({
        planned: 'include',
        access: { creator: userId },
        balanceAdjustments: 'include',
        where: { id: event.transactionId },
        paranoid: false,
        lock: true,
      }),
      message: t({ key: 'transactions.notFound' }),
    });
    await findOrThrowNotFound({
      query: Accounts.findOne({ where: { id: tx.accountId, userId }, attributes: ['id'] }),
      message: t({ key: 'transactions.notFound' }),
    });
    await tx.update({ transferNature: snapshot.transferNature });
    await event.update({ transactionId: null, originalTransactionState: null });
  },
);
