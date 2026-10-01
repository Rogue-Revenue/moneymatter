import { api } from '@/api/_api';
import type { RecordId } from '@bt/shared/types';
import type {
  CreateMetalEventInput,
  CreateMetalHoldingInput,
  CreateMetalQuoteInput,
  MetalHoldingDetailDto,
  MetalsOverviewDto,
  UpdateMetalHoldingInput,
} from '@bt/shared/types/precious-metals';

export const getMetalsOverview = (): Promise<MetalsOverviewDto> => api.get('/precious-metals');

export const getMetalHolding = ({ id }: { id: string }): Promise<MetalHoldingDetailDto> =>
  api.get(`/precious-metals/${id}`);

export const createMetalHolding = (payload: CreateMetalHoldingInput): Promise<MetalHoldingDetailDto> =>
  api.post('/precious-metals', payload);

export const updateMetalHolding = ({
  id,
  payload,
}: {
  id: string;
  payload: UpdateMetalHoldingInput;
}): Promise<MetalHoldingDetailDto> => api.patch(`/precious-metals/${id}`, payload);

export const createMetalEvent = ({
  id,
  payload,
}: {
  id: string;
  payload: CreateMetalEventInput;
}): Promise<MetalHoldingDetailDto> => api.post(`/precious-metals/${id}/events`, payload);

export const deleteMetalEvent = ({ id, eventId }: { id: string; eventId: string }): Promise<void> =>
  api.delete(`/precious-metals/${id}/events/${eventId}`);

export const linkMetalEvent = ({
  id,
  eventId,
  transactionId,
}: {
  id: string;
  eventId: string;
  transactionId: RecordId;
}): Promise<void> => api.post(`/precious-metals/${id}/events/${eventId}/link`, { transactionId });

export const unlinkMetalEvent = ({ id, eventId }: { id: string; eventId: string }): Promise<void> =>
  api.delete(`/precious-metals/${id}/events/${eventId}/link`);

export const createMetalQuote = ({
  id,
  payload,
}: {
  id: string;
  payload: CreateMetalQuoteInput;
}): Promise<MetalHoldingDetailDto> => api.post(`/precious-metals/${id}/quotes`, payload);

export const refreshMetalPrices = (): Promise<{ configured: boolean; refreshed: boolean }> =>
  api.post('/precious-metals/refresh');
