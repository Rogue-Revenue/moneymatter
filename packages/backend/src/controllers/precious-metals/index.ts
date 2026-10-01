import { PRECIOUS_METALS } from '@bt/shared/types/precious-metals';
import { currencyCode, recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { NON_CURRENCY_CODES } from '@models/currencies.model';
import * as holdings from '@services/precious-metals/holdings.service';
import { linkMetalEvent, unlinkMetalEvent } from '@services/precious-metals/linking';
import { refreshMetalPrices } from '@services/precious-metals/pricing/refresh';
import Big from 'big.js';
import { z } from 'zod';

const fiatCurrency = () => currencyCode().refine((value) => !NON_CURRENCY_CODES.includes(value));
const positiveDecimal = () =>
  z
    .string()
    .regex(/^\d{1,10}(\.\d{1,12})?$/)
    .pipe(z.string().refine((value) => new Big(value).gt(0) && new Big(value).lte('1000000000')));
const eventDate = () =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
      const date = new Date(`${value}T00:00:00.000Z`);
      return (
        Number.isFinite(date.getTime()) &&
        date.toISOString().slice(0, 10) === value &&
        value >= '0001-01-01' &&
        value <= new Date().toISOString().slice(0, 10)
      );
    });
const amount = () => z.number().finite().min(0).max(9999999999).nullable();
const lotSchema = z.object({
  date: eventDate(),
  quantity: positiveDecimal(),
  totalAmount: amount(),
  notes: z.string().max(5000).nullable().optional(),
});
const eventSchema = lotSchema.extend({
  type: z.enum(['opening', 'purchase', 'sale']),
  transactionId: recordId().nullable().optional(),
});
const idParams = z.object({ id: recordId() });
const eventParams = idParams.extend({ eventId: recordId() });

export const list = createController(z.object({}), async ({ user }) => ({
  data: await holdings.listMetalHoldings({ userId: user.id }),
}));
export const get = createController(z.object({ params: idParams }), async ({ user, params }) => ({
  data: await holdings.getMetalHolding({ userId: user.id, holdingId: params.id }),
}));
export const create = createController(
  z.object({
    body: z
      .object({
        name: z.string().trim().min(1).max(255),
        metal: z.enum(PRECIOUS_METALS),
        form: z.enum(['coin', 'bar', 'round']),
        weightPerItem: positiveDecimal(),
        weightUnit: z.enum(['g', 'troy_oz']),
        weightBasis: z.enum(['gross', 'fine']),
        purity: positiveDecimal().pipe(z.string().refine((value) => new Big(value).lte(1))),
        currencyCode: fiatCurrency(),
        storageNotes: z.string().max(5000).nullable().optional(),
        pricingMode: z.enum(['automatic', 'manual']).optional(),
        openingLot: lotSchema.optional(),
      })
      .strict(),
  }),
  async ({ user, body }) => ({ data: await holdings.createMetalHolding({ userId: user.id, input: body }) }),
);
export const update = createController(
  z.object({
    params: idParams,
    body: z
      .object({
        name: z.string().trim().min(1).max(255).optional(),
        storageNotes: z.string().max(5000).nullable().optional(),
        pricingMode: z.enum(['automatic', 'manual']).optional(),
      })
      .strict(),
  }),
  async ({ user, params, body }) => ({
    data: await holdings.updateMetalHolding({ userId: user.id, holdingId: params.id, input: body }),
  }),
);
export const createEvent = createController(
  z.object({ params: idParams, body: eventSchema.strict() }),
  async ({ user, params, body }) => ({
    data: await holdings.createMetalEvent({ userId: user.id, holdingId: params.id, input: body }),
  }),
);
export const deleteEvent = createController(z.object({ params: eventParams }), async ({ user, params }) => ({
  data: await holdings.deleteMetalEvent({ userId: user.id, holdingId: params.id, eventId: params.eventId }),
}));
export const link = createController(
  z.object({ params: eventParams, body: z.object({ transactionId: recordId() }) }),
  async ({ user, params, body }) => {
    await linkMetalEvent({
      userId: user.id,
      holdingId: params.id,
      eventId: params.eventId,
      transactionId: body.transactionId,
    });
    return { data: { success: true } };
  },
);
export const unlink = createController(z.object({ params: eventParams }), async ({ user, params }) => {
  await unlinkMetalEvent({ userId: user.id, holdingId: params.id, eventId: params.eventId });
  return { data: { success: true } };
});
export const createQuote = createController(
  z.object({
    params: idParams,
    body: z
      .object({
        pricePerTroyOz: z.number().finite().positive().max(9999999999),
        currencyCode: fiatCurrency(),
        asOf: z.iso.datetime({ offset: true }).refine((value) => new Date(value).getTime() <= Date.now()),
      })
      .strict(),
  }),
  async ({ user, params, body }) => ({
    data: await holdings.createMetalQuote({ userId: user.id, holdingId: params.id, input: body }),
  }),
);
export const refresh = createController(z.object({}), async () => ({ data: await refreshMetalPrices({}) }));
