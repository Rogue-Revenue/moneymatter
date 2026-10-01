import { RecordId } from '@bt/shared/types';
import type { PreciousMetal } from '@bt/shared/types/precious-metals';
import { IdColumn } from '@common/types/id-column';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import { BelongsTo, Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript';

import Currencies from '../currencies.model';
import Users from '../users.model';
import Holdings from './holdings.model';

@Table({ timestamps: true, tableName: 'PreciousMetalQuotes' })
export default class PreciousMetalQuotes extends Model {
  @Column(IdColumn()) declare id: RecordId;
  @ForeignKey(() => Users) @Column({ type: DataType.INTEGER, allowNull: true }) declare userId: number | null;
  @ForeignKey(() => Holdings) @Column({ type: DataType.UUID, allowNull: true }) declare holdingId: RecordId | null;
  @Column({ type: DataType.STRING(8), allowNull: false }) declare metal: PreciousMetal;
  @ForeignKey(() => Currencies) @Column({ type: DataType.STRING(3), allowNull: false }) declare currencyCode: string;
  @MoneyField({ storage: 'decimal', precision: 20, scale: 10 }) declare pricePerTroyOz: Money;
  @Column({ type: DataType.DATE, allowNull: false }) declare asOf: Date;
  @Column({ type: DataType.DATE, allowNull: false }) declare retrievedAt: Date;
  @Column({ type: DataType.STRING(64), allowNull: false }) declare source: string;
  @Column({ type: DataType.DATE, allowNull: false }) declare createdAt: Date;
  @Column({ type: DataType.DATE, allowNull: false }) declare updatedAt: Date;
  @BelongsTo(() => Users) declare user?: Users;
  @BelongsTo(() => Currencies, 'currencyCode') declare currency?: Currencies;
  @BelongsTo(() => Holdings) declare holding?: Holdings;
}
