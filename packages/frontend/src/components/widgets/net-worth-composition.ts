/**
 * Shared between the balance-trend and net-worth widgets. Each widget persists its
 * own config keys (`include*InTotal` vs `include*`) and maps them onto this shape,
 * so renaming either widget's stored keys is never required.
 */
export interface NetWorthIncludeSettings {
  includeVentures: boolean;
  includeVehicles: boolean;
  includeLoans: boolean;
  includeMetals: boolean;
}

export interface NetWorthComponentBalances {
  accountsBalance: number;
  portfoliosBalance: number;
  venturesBalance: number;
  vehiclesBalance: number;
  loansBalance: number;
  metalsBalance: number;
  totalBalance: number;
}

export interface MetalsValuationCounts {
  unvaluedMetalsCount: number;
  staleMetalsCount: number;
}

/** Only valuations contributing to the displayed totals need a warning. */
export function getMetalsValuationStatus({
  points,
  includeMetals,
}: {
  points: MetalsValuationCounts[];
  includeMetals: boolean;
}): { hasUnvaluedMetals: boolean; hasStaleMetals: boolean } {
  return {
    hasUnvaluedMetals: includeMetals && points.some((point) => point.unvaluedMetalsCount > 0),
    hasStaleMetals: includeMetals && points.some((point) => point.staleMetalsCount > 0),
  };
}

/** Inventory awaiting a quote is still data even when the known total is zero. */
export function hasNetWorthData({
  points,
  settings,
}: {
  points: (NetWorthComponentBalances & MetalsValuationCounts)[];
  settings: NetWorthIncludeSettings;
}): boolean {
  return points.some(
    (point) => composeNetWorth({ point, settings }) !== 0 || (settings.includeMetals && point.unvaluedMetalsCount > 0),
  );
}

export function composeNetWorth({
  point,
  settings,
}: {
  point: NetWorthComponentBalances;
  settings: NetWorthIncludeSettings;
}): number {
  // With nothing excluded the server-computed total is authoritative.
  if (settings.includeVentures && settings.includeVehicles && settings.includeLoans && settings.includeMetals) {
    return point.totalBalance;
  }

  let total = point.accountsBalance + point.portfoliosBalance;
  if (settings.includeVentures) total += point.venturesBalance;
  if (settings.includeVehicles) total += point.vehiclesBalance;
  // Loan balances are negative: including them subtracts debt, excluding them ignores it.
  if (settings.includeLoans) total += point.loansBalance;
  if (settings.includeMetals) total += point.metalsBalance;
  return total;
}
