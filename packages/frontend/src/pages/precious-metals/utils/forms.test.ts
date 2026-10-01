import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import {
  getMetalLinkError,
  normalizeMetalDecimal,
  parseMetalAmount,
  parseMetalPurity,
  validateMetalEvent,
} from './forms';

describe('metal form values', () => {
  it('normalizes fractional text without losing weight precision', () => {
    expect(normalizeMetalDecimal({ value: ' .5 ' })).toBe('0.5');
    expect(normalizeMetalDecimal({ value: ' 00031.103476812345 ' })).toBe('31.103476812345');
  });
  it('keeps unknown costs distinct from a known zero cost', () => {
    expect(parseMetalAmount({ value: '' })).toBeNull();
    expect(parseMetalAmount({ value: '0' })).toBe(0);
    expect(parseMetalAmount({ value: '350.75' })).toBe(350.75);
    expect(parseMetalAmount({ value: '-1' })).toBeUndefined();
    expect(parseMetalAmount({ value: 'NaN' })).toBeUndefined();
    expect(parseMetalAmount({ value: '10000000000' })).toBeUndefined();
  });

  it('converts percent purity precisely and rejects empty or out-of-range purity', () => {
    expect(parseMetalPurity({ value: '99.99' })).toBe('0.9999');
    expect(parseMetalPurity({ value: '91.67' })).toBe('0.9167');
    expect(parseMetalPurity({ value: '100' })).toBe('1');
    expect(parseMetalPurity({ value: '99.9999999999' })).toBe('0.999999999999');
    expect(parseMetalPurity({ value: '0.0000000001' })).toBe('0.000000000001');
    expect(parseMetalPurity({ value: '' })).toBeNull();
    expect(parseMetalPurity({ value: '0' })).toBeNull();
    expect(parseMetalPurity({ value: '100.1' })).toBeNull();
  });

  it('accepts historical opening lots and rejects future dates or impossible calendar dates', () => {
    const form = {
      type: 'opening' as const,
      date: '1980-01-05',
      quantity: '0.125',
      amount: '',
      availableQuantity: '0',
      today: '2026-10-01',
    };
    expect(validateMetalEvent(form)).toBeNull();
    expect(validateMetalEvent({ ...form, date: '2026-10-02' })).toBe('futureDate');
    expect(validateMetalEvent({ ...form, date: '2026-02-30' })).toBe('date');
    expect(validateMetalEvent({ ...form, quantity: '0' })).toBe('quantity');
    expect(validateMetalEvent({ ...form, quantity: '1000000001' })).toBe('quantity');
    expect(validateMetalEvent({ ...form, quantity: '0.0000000000001' })).toBe('quantity');
  });

  it('rejects overselling while allowing a complete fractional sale', () => {
    const form = {
      type: 'sale' as const,
      date: '2026-10-01',
      quantity: '0.25',
      amount: '100',
      availableQuantity: '0.25',
      today: '2026-10-01',
    };
    expect(validateMetalEvent(form)).toBeNull();
    expect(validateMetalEvent({ ...form, quantity: '0.251' })).toBe('oversell');
    expect(validateMetalEvent({ ...form, amount: '-4' })).toBe('amount');
  });
});

describe('linking existing metal cash movements', () => {
  const transaction = {
    currencyCode: 'USD',
    transactionType: TRANSACTION_TYPES.expense,
    amount: 350.75,
    isPlanned: false,
    transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
  };
  const event = { type: 'purchase' as const, currencyCode: 'USD', totalAmount: 350.75 };

  it('accepts an existing expense that exactly matches purchase cost', () => {
    expect(getMetalLinkError({ transaction, event })).toBeNull();
  });

  it('requires sale income and matching currency, amount, and actual transaction', () => {
    expect(getMetalLinkError({ transaction, event: { ...event, type: 'sale' } })).toBe('direction');
    expect(getMetalLinkError({ transaction: { ...transaction, currencyCode: 'EUR' }, event })).toBe('currency');
    expect(getMetalLinkError({ transaction: { ...transaction, amount: 351 }, event })).toBe('amount');
    expect(getMetalLinkError({ transaction: { ...transaction, isPlanned: true }, event })).toBe('planned');
    expect(getMetalLinkError({ transaction, event: { ...event, totalAmount: null } })).toBe('unknownAmount');
    expect(getMetalLinkError({ transaction, event: { ...event, type: 'opening' } })).toBe('opening');
  });

  it('rejects cash entries already classified as transfers', () => {
    expect(
      getMetalLinkError({
        transaction: { ...transaction, transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer },
        event,
      }),
    ).toBe('transfer');
  });
});
