import { DataTypes, QueryInterface } from 'sequelize';

const id = () => ({ type: DataTypes.UUID, primaryKey: true, allowNull: false });
const userId = ({ nullable = false } = {}) => ({
  type: DataTypes.INTEGER,
  allowNull: nullable,
  references: { model: 'Users', key: 'id' },
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE',
});
const holdingId = ({ nullable = false } = {}) => ({
  type: DataTypes.UUID,
  allowNull: nullable,
  references: { model: 'PreciousMetalHoldings', key: 'id' },
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE',
});
const timestamps = () => ({
  createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
});
const currencyCode = () => ({
  type: DataTypes.STRING(3),
  allowNull: false,
  references: { model: 'Currencies', key: 'code' },
  onUpdate: 'CASCADE',
});

module.exports = {
  up: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'PreciousMetalHoldings',
        {
          id: id(),
          userId: userId(),
          name: { type: DataTypes.STRING(255), allowNull: false },
          metal: { type: DataTypes.STRING(8), allowNull: false },
          form: { type: DataTypes.STRING(8), allowNull: false },
          weightPerItem: { type: DataTypes.DECIMAL(28, 12), allowNull: false },
          weightUnit: { type: DataTypes.STRING(8), allowNull: false },
          weightBasis: { type: DataTypes.STRING(8), allowNull: false },
          purity: { type: DataTypes.DECIMAL(13, 12), allowNull: false },
          currencyCode: currencyCode(),
          storageNotes: { type: DataTypes.TEXT, allowNull: true },
          pricingMode: { type: DataTypes.STRING(12), allowNull: false },
          pricingModeHistory: { type: DataTypes.JSONB, allowNull: false },
          ...timestamps(),
        },
        { transaction },
      );
      await queryInterface.createTable(
        'PreciousMetalEvents',
        {
          id: id(),
          userId: userId(),
          holdingId: holdingId(),
          type: { type: DataTypes.STRING(12), allowNull: false },
          date: { type: DataTypes.DATEONLY, allowNull: false },
          quantity: { type: DataTypes.DECIMAL(28, 12), allowNull: false },
          fineGramsPerItem: { type: DataTypes.DECIMAL(60, 34), allowNull: false },
          totalAmount: { type: DataTypes.DECIMAL(20, 10), allowNull: true },
          currencyCode: currencyCode(),
          notes: { type: DataTypes.TEXT, allowNull: true },
          transactionId: {
            type: DataTypes.UUID,
            allowNull: true,
            unique: true,
            references: { model: 'Transactions', key: 'id' },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
          },
          originalTransactionState: { type: DataTypes.JSONB, allowNull: true },
          ...timestamps(),
        },
        { transaction },
      );
      await queryInterface.createTable(
        'PreciousMetalQuotes',
        {
          id: id(),
          userId: userId({ nullable: true }),
          holdingId: holdingId({ nullable: true }),
          metal: { type: DataTypes.STRING(8), allowNull: false },
          currencyCode: currencyCode(),
          pricePerTroyOz: { type: DataTypes.DECIMAL(20, 10), allowNull: false },
          asOf: { type: DataTypes.DATE, allowNull: false },
          retrievedAt: { type: DataTypes.DATE, allowNull: false },
          source: { type: DataTypes.STRING(64), allowNull: false },
          ...timestamps(),
        },
        { transaction },
      );
      await queryInterface.addIndex('PreciousMetalHoldings', ['userId'], { transaction });
      await queryInterface.addIndex('PreciousMetalEvents', ['holdingId', 'date'], { transaction });
      await queryInterface.addIndex('PreciousMetalEvents', ['userId'], { transaction });
      await queryInterface.addIndex('PreciousMetalQuotes', ['holdingId', 'asOf'], { transaction });
      await queryInterface.addIndex('PreciousMetalQuotes', ['metal', 'currencyCode', 'asOf'], { transaction });
      await queryInterface.sequelize.query(
        `ALTER TABLE "PreciousMetalHoldings" ADD CONSTRAINT precious_metals_physical_spec CHECK (metal IN ('gold','silver','platinum') AND form IN ('coin','bar','round') AND "weightUnit" IN ('g','troy_oz') AND "weightBasis" IN ('gross','fine') AND "weightPerItem" > 0 AND purity > 0 AND purity <= 1 AND "pricingMode" IN ('automatic','manual'))`,
        { transaction },
      );
      await queryInterface.sequelize.query(
        `ALTER TABLE "PreciousMetalEvents" ADD CONSTRAINT precious_metals_event CHECK (type IN ('opening','purchase','sale') AND quantity > 0 AND "fineGramsPerItem" > 0 AND ("totalAmount" IS NULL OR "totalAmount" >= 0) AND (type <> 'opening' OR "transactionId" IS NULL))`,
        { transaction },
      );
      await queryInterface.sequelize.query(
        `ALTER TABLE "PreciousMetalQuotes" ADD CONSTRAINT precious_metals_quote CHECK ("pricePerTroyOz" > 0 AND (("userId" IS NULL AND "holdingId" IS NULL) OR ("userId" IS NOT NULL AND "holdingId" IS NOT NULL)))`,
        { transaction },
      );
    });
  },
  down: async (queryInterface: QueryInterface): Promise<void> => {
    await queryInterface.sequelize.transaction(async (transaction) => {
      // Restore matched cash classifications before removing the ledger that owns their links.
      await queryInterface.sequelize.query(
        `UPDATE "Transactions" AS tx
         SET "transferNature" = event."originalTransactionState"->>'transferNature'
         FROM "PreciousMetalEvents" AS event
         WHERE event."transactionId" = tx.id
           AND tx."transferNature" = 'transfer_to_precious_metals'
           AND event."originalTransactionState"->>'transferNature' IS NOT NULL`,
        { transaction },
      );
      await queryInterface.dropTable('PreciousMetalQuotes', { transaction });
      await queryInterface.dropTable('PreciousMetalEvents', { transaction });
      await queryInterface.dropTable('PreciousMetalHoldings', { transaction });
    });
  },
};
