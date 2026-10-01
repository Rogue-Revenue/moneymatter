import { RecordId } from '@bt/shared/types';
import type { MetalEventType } from '@bt/shared/types/precious-metals';
import { IdColumn } from '@common/types/id-column';
import { Money } from '@common/types/money';
import { MoneyField } from '@common/types/money-column';
import type { OriginalTransactionStateSnapshot } from '@services/common/transaction-linking';
import { BelongsTo, Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript';

import Currencies from '../currencies.model';
import Transactions from '../transactions.model';
import Users from '../users.model';
import Holdings from './holdings.model';

@Table({ timestamps: true, tableName: 'PreciousMetalEvents' })
export default class PreciousMetalEvents extends Model {
  @Column(IdColumn()) declare id: RecordId;
  @ForeignKey(() => Users) @Column({ type: DataType.INTEGER, allowNull: false }) declare userId: number;
  @ForeignKey(() => Holdings) @Column({ type: DataType.UUID, allowNull: false }) declare holdingId: RecordId;
  @Column({ type: DataType.STRING(12), allowNull: false }) declare type: MetalEventType;
  @Column({ type: DataType.DATEONLY, allowNull: false }) declare date: string;
  @Column({ type: DataType.DECIMAL(28, 12), allowNull: false }) declare quantity: string;
  @Column({ type: DataType.DECIMAL(60, 34), allowNull: false }) declare fineGramsPerItem: string;
  @MoneyField({ storage: 'decimal', precision: 20, scale: 10, allowNull: true }) declare totalAmount: Money | null;
  @ForeignKey(() => Currencies) @Column({ type: DataType.STRING(3), allowNull: false }) declare currencyCode: string;
  @Column({ type: DataType.TEXT, allowNull: true }) declare notes: string | null;
  @ForeignKey(() => Transactions)
  @Column({ type: DataType.UUID, allowNull: true, unique: true })
  declare transactionId: RecordId | null;
  @Column({ type: DataType.JSONB, allowNull: true })
  declare originalTransactionState: OriginalTransactionStateSnapshot | null;
  @Column({ type: DataType.DATE, allowNull: false }) declare createdAt: Date;
  @Column({ type: DataType.DATE, allowNull: false }) declare updatedAt: Date;
  @BelongsTo(() => Users) declare user?: Users;
  @BelongsTo(() => Currencies, 'currencyCode') declare currency?: Currencies;
  @BelongsTo(() => Holdings) declare holding?: Holdings;
  @BelongsTo(() => Transactions) declare transaction?: Transactions;
}
