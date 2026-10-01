import { utcDayKey } from '@/common/utils/date';
import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES, type TransactionModel } from '@bt/shared/types';
import type { MetalEventType } from '@bt/shared/types/precious-metals';
import { format, isValid, parseISO } from 'date-fns';

const DECIMAL = /^(?:\d+(?:\.\d+)?|\.\d+)$/;
const MAX_AMOUNT = 9_999_999_999;
const MAX_QUANTITY_OR_WEIGHT = 1_000_000_000;

export const METAL_EVENT_VALIDATION_KEYS = {
  date: 'forms.validators.preciousMetalsDate',
  futureDate: 'forms.validators.preciousMetalsFutureDate',
  quantity: 'forms.validators.preciousMetalsQuantity',
  oversell: 'forms.validators.preciousMetalsOversell',
  amount: 'forms.validators.preciousMetalsAmount',
} as const;

export const normalizeMetalDecimal = ({ value }: { value: string }): string =>
  value
    .trim()
    .replace(/^\./, '0.')
    .replace(/^0+(?=\d)/, '');

export const isPositiveMetalDecimal = ({ value }: { value: string }): boolean => {
  const normalized = normalizeMetalDecimal({ value });
  return (
    /^\d{1,10}(\.\d{1,12})?$/.test(normalized) && Number(normalized) > 0 && Number(normalized) <= MAX_QUANTITY_OR_WEIGHT
  );
};

export const parseMetalAmount = ({ value }: { value: string }): number | null | undefined => {
  if (!value.trim()) return null;
  if (!DECIMAL.test(value.trim()) || !Number.isFinite(Number(value)) || Number(value) > MAX_AMOUNT) return undefined;
  return Number(value);
};

export const parseMetalPurity = ({ value }: { value: string }): string | null => {
  const normalized = normalizeMetalDecimal({ value });
  if (!/^\d{1,3}(\.\d{1,10})?$/.test(normalized) || Number(normalized) <= 0 || Number(normalized) > 100) return null;
  const [whole, decimals = ''] = normalized.split('.');
  const padded = whole!.padStart(3, '0');
  return `${padded.slice(0, -2)}.${padded.slice(-2)}${decimals}`.replace(/0+$/, '').replace(/\.$/, '');
};

export const validateMetalEvent = ({
  type,
  date,
  quantity,
  amount,
  availableQuantity,
  today = utcDayKey({ date: new Date() }),
}: {
  type: MetalEventType;
  date: string;
  quantity: string;
  amount: string;
  availableQuantity: string;
  today?: string;
}): 'date' | 'futureDate' | 'quantity' | 'oversell' | 'amount' | null => {
  const parsed = parseISO(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isValid(parsed) || format(parsed, 'yyyy-MM-dd') !== date) return 'date';
  if (date > today) return 'futureDate';
  if (!isPositiveMetalDecimal({ value: quantity })) return 'quantity';
  if (type === 'sale' && Number(quantity) > Number(availableQuantity)) return 'oversell';
  if (parseMetalAmount({ value: amount }) === undefined) return 'amount';
  return null;
};

export const getMetalLinkError = ({
  transaction,
  event,
}: {
  transaction: Pick<TransactionModel, 'transactionType' | 'currencyCode' | 'amount' | 'isPlanned' | 'transferNature'> &
    Partial<Pick<TransactionModel, 'refundLinked'>>;
  event: { type: MetalEventType; currencyCode: string; totalAmount: number | null };
}): 'opening' | 'unknownAmount' | 'planned' | 'refund' | 'transfer' | 'currency' | 'direction' | 'amount' | null => {
  if (event.type === 'opening') return 'opening';
  if (event.totalAmount === null) return 'unknownAmount';
  if (transaction.isPlanned) return 'planned';
  if (transaction.refundLinked) return 'refund';
  if (transaction.transferNature !== TRANSACTION_TRANSFER_NATURE.not_transfer) return 'transfer';
  if (transaction.currencyCode !== event.currencyCode) return 'currency';
  const expectedType = event.type === 'sale' ? TRANSACTION_TYPES.income : TRANSACTION_TYPES.expense;
  if (transaction.transactionType !== expectedType) return 'direction';
  if (Math.abs(transaction.amount) !== event.totalAmount) return 'amount';
  return null;
};
