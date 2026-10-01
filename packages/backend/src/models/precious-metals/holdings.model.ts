import { RecordId } from '@bt/shared/types';
import type { MetalPhysicalSpec, MetalPricingMode, MetalPricingModeChange } from '@bt/shared/types/precious-metals';
import { IdColumn } from '@common/types/id-column';
import { BelongsTo, Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript';

import Currencies from '../currencies.model';
import Users from '../users.model';

@Table({ timestamps: true, tableName: 'PreciousMetalHoldings' })
export default class PreciousMetalHoldings extends Model {
  @Column(IdColumn()) declare id: RecordId;
  @ForeignKey(() => Users) @Column({ type: DataType.INTEGER, allowNull: false }) declare userId: number;
  @Column({ type: DataType.STRING(255), allowNull: false }) declare name: string;
  @Column({ type: DataType.STRING(8), allowNull: false }) declare metal: MetalPhysicalSpec['metal'];
  @Column({ type: DataType.STRING(8), allowNull: false }) declare form: MetalPhysicalSpec['form'];
  @Column({ type: DataType.DECIMAL(28, 12), allowNull: false }) declare weightPerItem: string;
  @Column({ type: DataType.STRING(8), allowNull: false }) declare weightUnit: MetalPhysicalSpec['weightUnit'];
  @Column({ type: DataType.STRING(8), allowNull: false }) declare weightBasis: MetalPhysicalSpec['weightBasis'];
  @Column({ type: DataType.DECIMAL(13, 12), allowNull: false }) declare purity: string;
  @ForeignKey(() => Currencies) @Column({ type: DataType.STRING(3), allowNull: false }) declare currencyCode: string;
  @Column({ type: DataType.TEXT, allowNull: true }) declare storageNotes: string | null;
  @Column({ type: DataType.STRING(12), allowNull: false }) declare pricingMode: MetalPricingMode;
  @Column({ type: DataType.JSONB, allowNull: false }) declare pricingModeHistory: MetalPricingModeChange[];
  @Column({ type: DataType.DATE, allowNull: false }) declare createdAt: Date;
  @Column({ type: DataType.DATE, allowNull: false }) declare updatedAt: Date;
  @BelongsTo(() => Users) declare user?: Users;
  @BelongsTo(() => Currencies, 'currencyCode') declare currency?: Currencies;
}
