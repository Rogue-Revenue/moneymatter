import { describe, expect, it } from 'vitest';

import {
  type MetalsValuationCounts,
  type NetWorthComponentBalances,
  type NetWorthIncludeSettings,
  getMetalsValuationStatus,
  hasNetWorthData,
} from './net-worth-composition';

const SETTINGS: NetWorthIncludeSettings = {
  includeLoans: true,
  includeVehicles: true,
  includeVentures: true,
  includeMetals: true,
};

const POINT: NetWorthComponentBalances & MetalsValuationCounts = {
  accountsBalance: 0,
  portfoliosBalance: 0,
  venturesBalance: 0,
  vehiclesBalance: 0,
  loansBalance: 0,
  metalsBalance: 0,
  totalBalance: 0,
  unvaluedMetalsCount: 0,
  staleMetalsCount: 0,
};

describe('getMetalsValuationStatus', () => {
  it('detects incomplete and stale valuations across the displayed range', () => {
    expect(
      getMetalsValuationStatus({
        points: [
          { ...POINT, unvaluedMetalsCount: 2 },
          { ...POINT, staleMetalsCount: 1 },
        ],
        includeMetals: true,
      }),
    ).toEqual({ hasUnvaluedMetals: true, hasStaleMetals: true });
  });

  it('suppresses warnings for excluded metals', () => {
    expect(
      getMetalsValuationStatus({
        points: [{ ...POINT, unvaluedMetalsCount: 2, staleMetalsCount: 1 }],
        includeMetals: false,
      }),
    ).toEqual({ hasUnvaluedMetals: false, hasStaleMetals: false });
  });

  it('has no warnings for an empty range', () => {
    expect(getMetalsValuationStatus({ points: [], includeMetals: true })).toEqual({
      hasUnvaluedMetals: false,
      hasStaleMetals: false,
    });
  });
});

describe('hasNetWorthData', () => {
  it('keeps a metals-only account visible even before its first quote', () => {
    expect(hasNetWorthData({ points: [{ ...POINT, unvaluedMetalsCount: 1 }], settings: SETTINGS })).toBe(true);
  });

  it('detects priced metals without cash or brokerage assets', () => {
    expect(hasNetWorthData({ points: [{ ...POINT, metalsBalance: 200, totalBalance: 200 }], settings: SETTINGS })).toBe(
      true,
    );
  });

  it('does not treat missing quotes in excluded metals as displayed data', () => {
    expect(
      hasNetWorthData({
        points: [{ ...POINT, unvaluedMetalsCount: 1 }],
        settings: { ...SETTINGS, includeMetals: false },
      }),
    ).toBe(false);
  });

  it('recognizes empty and all-zero histories', () => {
    expect(hasNetWorthData({ points: [], settings: SETTINGS })).toBe(false);
    expect(hasNetWorthData({ points: [POINT], settings: SETTINGS })).toBe(false);
  });
});
