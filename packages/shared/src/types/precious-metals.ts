import type { RecordId } from './record-id';

export const PRECIOUS_METALS = ['gold', 'silver', 'platinum'] as const;
export type PreciousMetal = (typeof PRECIOUS_METALS)[number];
export type PreciousMetalForm = 'coin' | 'bar' | 'round';
export type MetalWeightUnit = 'g' | 'troy_oz';
export type MetalWeightBasis = 'gross' | 'fine';
export type MetalPricingMode = 'automatic' | 'manual';
export type MetalEventType = 'opening' | 'purchase' | 'sale';

export interface MetalPhysicalSpec {
  metal: PreciousMetal;
  form: PreciousMetalForm;
  weightPerItem: string;
  weightUnit: MetalWeightUnit;
  weightBasis: MetalWeightBasis;
  /** Fraction of pure metal, greater than zero and at most one. */
  purity: string;
}
export interface MetalPricingModeChange {
  mode: MetalPricingMode;
  effectiveAt: string;
}
export interface CreateMetalHoldingInput extends MetalPhysicalSpec {
  name: string;
  currencyCode: string;
  storageNotes?: string | null;
  pricingMode?: MetalPricingMode;
  openingLot?: Omit<CreateMetalEventInput, 'type' | 'transactionId'>;
}
export interface UpdateMetalHoldingInput {
  name?: string;
  storageNotes?: string | null;
  pricingMode?: MetalPricingMode;
}
export interface CreateMetalEventInput {
  type: MetalEventType;
  date: string;
  quantity: string;
  /** Purchase/opening: all-in cost. Sale: proceeds after fees. Null means unknown. */
  totalAmount: number | null;
  transactionId?: RecordId | null;
  notes?: string | null;
}
export interface CreateMetalQuoteInput {
  pricePerTroyOz: number;
  currencyCode: string;
  asOf: string;
}
export interface MetalQuoteDto {
  id: RecordId;
  metal: PreciousMetal;
  pricePerTroyOz: number;
  currencyCode: string;
  asOf: string;
  retrievedAt: string;
  source: string;
  isManual: boolean;
  isStale: boolean;
}
export interface MetalLotDto {
  eventId: RecordId;
  date: string;
  quantity: string;
  remainingQuantity: string;
  fineGramsPerItem: string;
  originalCost: number | null;
  remainingCost: number | null;
}
export interface MetalEventDto {
  id: RecordId;
  type: MetalEventType;
  date: string;
  quantity: string;
  totalAmount: number | null;
  currencyCode: string;
  notes: string | null;
  transactionId: RecordId | null;
  costBasis: number | null;
  realizedGain: number | null;
  createdAt: string;
}
export interface MetalValuationDto {
  quantity: string;
  fineGrams: string;
  fineTroyOunces: string;
  knownCostBasis: number;
  costBasisComplete: boolean;
  unknownCostQuantity: string;
  spotValue: number | null;
  unrealizedGain: number | null;
  realizedGain: number | null;
  currencyCode: string;
  status: 'current' | 'stale' | 'missing_price' | 'missing_fx' | 'empty';
  quote: MetalQuoteDto | null;
}
export interface MetalHoldingDto extends MetalPhysicalSpec {
  id: RecordId;
  name: string;
  currencyCode: string;
  storageNotes: string | null;
  pricingMode: MetalPricingMode;
  createdAt: string;
  valuation: MetalValuationDto;
}
export interface MetalHoldingDetailDto extends MetalHoldingDto {
  lots: MetalLotDto[];
  events: MetalEventDto[];
  quotes: MetalQuoteDto[];
}
export interface MetalsOverviewDto {
  holdings: MetalHoldingDto[];
  provider: { name: string; configured: boolean; refreshHours: number };
}
