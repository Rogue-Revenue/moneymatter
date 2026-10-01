import type { RecordId } from '@bt/shared/types';
import type {
  CreateMetalEventInput,
  CreateMetalHoldingInput,
  CreateMetalQuoteInput,
  UpdateMetalHoldingInput,
} from '@bt/shared/types/precious-metals';
import type * as holdings from '@services/precious-metals/holdings.service';
import type { refreshMetalPrices as apiRefreshMetalPrices } from '@services/precious-metals/pricing/refresh';

import { makeRequest } from './common';

export const buildMetalHoldingPayload = ({
  overrides = {},
}: { overrides?: Partial<CreateMetalHoldingInput> } = {}): CreateMetalHoldingInput => ({
  name: 'Synthetic gold coin',
  metal: 'gold',
  form: 'coin',
  weightPerItem: '1',
  weightUnit: 'troy_oz',
  weightBasis: 'fine',
  purity: '0.9999',
  currencyCode: global.BASE_CURRENCY.code,
  pricingMode: 'manual',
  ...overrides,
});

export async function listMetalHoldings<R extends boolean | undefined = false>({ raw }: { raw?: R } = {}) {
  return makeRequest<Awaited<ReturnType<typeof holdings.listMetalHoldings>>, R>({
    method: 'get',
    url: '/precious-metals',
    raw,
  });
}

export async function getMetalHolding<R extends boolean | undefined = false>({
  holdingId,
  raw,
}: {
  holdingId: RecordId;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof holdings.getMetalHolding>>, R>({
    method: 'get',
    url: `/precious-metals/${holdingId}`,
    raw,
  });
}

export async function createMetalHolding<R extends boolean | undefined = false>({
  payload = buildMetalHoldingPayload(),
  raw,
}: { payload?: CreateMetalHoldingInput; raw?: R } = {}) {
  return makeRequest<Awaited<ReturnType<typeof holdings.createMetalHolding>>, R>({
    method: 'post',
    url: '/precious-metals',
    payload,
    raw,
  });
}

export async function updateMetalHolding<R extends boolean | undefined = false>({
  holdingId,
  payload,
  raw,
}: {
  holdingId: RecordId;
  payload: UpdateMetalHoldingInput;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof holdings.updateMetalHolding>>, R>({
    method: 'patch',
    url: `/precious-metals/${holdingId}`,
    payload,
    raw,
  });
}

export async function createMetalEvent<R extends boolean | undefined = false>({
  holdingId,
  payload,
  raw,
}: {
  holdingId: RecordId;
  payload: CreateMetalEventInput;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof holdings.createMetalEvent>>, R>({
    method: 'post',
    url: `/precious-metals/${holdingId}/events`,
    payload,
    raw,
  });
}

export async function deleteMetalEvent<R extends boolean | undefined = false>({
  holdingId,
  eventId,
  raw,
}: {
  holdingId: RecordId;
  eventId: RecordId;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof holdings.deleteMetalEvent>>, R>({
    method: 'delete',
    url: `/precious-metals/${holdingId}/events/${eventId}`,
    raw,
  });
}

export async function createMetalQuote<R extends boolean | undefined = false>({
  holdingId,
  payload,
  raw,
}: {
  holdingId: RecordId;
  payload: CreateMetalQuoteInput;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof holdings.createMetalQuote>>, R>({
    method: 'post',
    url: `/precious-metals/${holdingId}/quotes`,
    payload,
    raw,
  });
}

export async function linkMetalEvent<R extends boolean | undefined = false>({
  holdingId,
  eventId,
  transactionId,
  raw,
}: {
  holdingId: RecordId;
  eventId: RecordId;
  transactionId: RecordId;
  raw?: R;
}) {
  return makeRequest<{ success: boolean }, R>({
    method: 'post',
    url: `/precious-metals/${holdingId}/events/${eventId}/link`,
    payload: { transactionId },
    raw,
  });
}

export async function unlinkMetalEvent<R extends boolean | undefined = false>({
  holdingId,
  eventId,
  raw,
}: {
  holdingId: RecordId;
  eventId: RecordId;
  raw?: R;
}) {
  return makeRequest<{ success: boolean }, R>({
    method: 'delete',
    url: `/precious-metals/${holdingId}/events/${eventId}/link`,
    raw,
  });
}

export async function refreshMetalPrices<R extends boolean | undefined = false>({ raw }: { raw?: R } = {}) {
  return makeRequest<Awaited<ReturnType<typeof apiRefreshMetalPrices>>, R>({
    method: 'post',
    url: '/precious-metals/refresh',
    raw,
  });
}
