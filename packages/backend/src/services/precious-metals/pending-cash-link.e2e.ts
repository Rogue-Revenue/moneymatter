import { BANK_PROVIDER_TYPE, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import type { RecordId } from '@bt/shared/types';
import type { CreateMetalEventInput } from '@bt/shared/types/precious-metals';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { type FixedTransaction, MOCK_IDENTIFICATION_HASH_1 } from '@tests/mocks/enablebanking/data';

const date = '2025-05-28';
const sale: CreateMetalEventInput = { type: 'sale', date, quantity: '1', totalAmount: 140 };

const importCashTransaction = async ({ status }: { status: FixedTransaction['status'] }) => {
  helpers.enablebanking.setFixedTransactions([
    {
      entryReference: 'synthetic-metal-cash',
      amount: '140.00',
      currency: 'EUR',
      isExpense: true,
      creditDebitIndicator: 'CRDT',
      transactionDate: date,
      ...(status === 'BOOK' ? { bookingDate: date } : {}),
      counterpartyIban: null,
      status,
    },
  ]);
  const { connectionId } = await helpers.bankDataProviders.connectProvider({
    providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
    credentials: helpers.enablebanking.mockCredentials(),
    raw: true,
  });
  const state = await helpers.enablebanking.getConnectionState(connectionId);
  const callback = await helpers.makeRequest({
    method: 'post',
    url: '/bank-data-providers/enablebanking/oauth-callback',
    payload: { connectionId, code: helpers.enablebanking.mockAuthCode, state },
  });
  expect(callback.statusCode).toBe(200);
  const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
    connectionId,
    accountExternalIds: [MOCK_IDENTIFICATION_HASH_1],
    raw: true,
  });
  const accountId = syncedAccounts[0]!.id as RecordId;
  const transactions = await helpers.getTransactions({ accountIds: [accountId], raw: true });
  expect(transactions).toHaveLength(1);
  const transaction = (await helpers.getTransactionById({ id: transactions[0]!.id, raw: true }))!;
  expect(transaction).toMatchObject({
    amount: 140,
    currencyCode: 'EUR',
    transactionType: TRANSACTION_TYPES.income,
    isPlanned: false,
    isPending: status === 'PDNG' || status === 'HOLD',
    transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
  });
  return { accountId, transaction: transaction as typeof transaction & { id: RecordId } };
};

const createHolding = () =>
  helpers.createMetalHolding({
    payload: helpers.buildMetalHoldingPayload({
      overrides: {
        currencyCode: 'EUR',
        openingLot: { date: '2025-01-01', quantity: '2', totalAmount: 200 },
      },
    }),
    raw: true,
  });

describe('Physical metal links require settled bank cash', () => {
  beforeEach(async () => {
    helpers.enablebanking.resetSessionCounter();
    await helpers.patchUserSettings({ patch: { importPendingBankTransactions: true }, raw: true });
  });

  afterEach(() => {
    helpers.enablebanking.resetTransactionConfig();
  });

  it.each(['PDNG', 'HOLD'] as const)(
    'rejects an explicit link to %s cash without changing either record',
    async (status) => {
      const { accountId, transaction } = await importCashTransaction({ status });
      const holding = await createHolding();
      const before = await helpers.createMetalEvent({ holdingId: holding.id, payload: sale, raw: true });
      const event = before.events.find((candidate) => candidate.type === 'sale')!;
      const balanceBefore = (await helpers.getAccount({ id: accountId, raw: true })).currentBalance;

      const result = await helpers.linkMetalEvent({
        holdingId: holding.id,
        eventId: event.id,
        transactionId: transaction.id,
      });

      expect(result.statusCode).toBe(422);
      const after = await helpers.getMetalHolding({ holdingId: holding.id, raw: true });
      expect(after.events).toEqual(before.events);
      expect(after.valuation.quantity).toBe(before.valuation.quantity);
      expect(await helpers.getTransactionById({ id: transaction.id, raw: true })).toEqual(transaction);
      expect((await helpers.getAccount({ id: accountId, raw: true })).currentBalance).toBe(balanceBefore);
    },
  );

  it.each(['PDNG', 'HOLD'] as const)('rolls back an inline sale linked to %s cash', async (status) => {
    const { accountId, transaction } = await importCashTransaction({ status });
    const before = await createHolding();
    const balanceBefore = (await helpers.getAccount({ id: accountId, raw: true })).currentBalance;

    const result = await helpers.createMetalEvent({
      holdingId: before.id,
      payload: { ...sale, transactionId: transaction.id },
    });

    expect(result.statusCode).toBe(422);
    const after = await helpers.getMetalHolding({ holdingId: before.id, raw: true });
    expect(after.events).toEqual(before.events);
    expect(after.valuation.quantity).toBe(before.valuation.quantity);
    expect(await helpers.getTransactionById({ id: transaction.id, raw: true })).toEqual(transaction);
    expect((await helpers.getAccount({ id: accountId, raw: true })).currentBalance).toBe(balanceBefore);
  });

  it.each(['BOOK', 'OTHR'] as const)('allows %s cash through explicit and inline linking', async (status) => {
    const { transaction } = await importCashTransaction({ status });
    const holding = await createHolding();
    const before = await helpers.createMetalEvent({ holdingId: holding.id, payload: sale, raw: true });
    const event = before.events.find((candidate) => candidate.type === 'sale')!;

    expect(
      (await helpers.linkMetalEvent({ holdingId: holding.id, eventId: event.id, transactionId: transaction.id }))
        .statusCode,
    ).toBe(200);
    expect((await helpers.getMetalHolding({ holdingId: holding.id, raw: true })).events.at(-1)!.transactionId).toBe(
      transaction.id,
    );
    await helpers.unlinkMetalEvent({ holdingId: holding.id, eventId: event.id, raw: true });
    const after = await helpers.createMetalEvent({
      holdingId: holding.id,
      payload: { ...sale, transactionId: transaction.id },
      raw: true,
    });
    expect(after.events.find((candidate) => candidate.transactionId === transaction.id)?.type).toBe('sale');
    expect((await helpers.getTransactionById({ id: transaction.id, raw: true }))?.transferNature).toBe(
      TRANSACTION_TRANSFER_NATURE.transfer_to_precious_metals,
    );
  });
});
