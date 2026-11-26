import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentMethod, SaleStatus, StockMovementType, SyncStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { SalesService } from './sales.service.js';

type MockTx = {
  $queryRaw: ReturnType<typeof vi.fn>;
  products: { findFirst: ReturnType<typeof vi.fn> };
  customers: {
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  sales: { create: ReturnType<typeof vi.fn> };
  stock_movements: { create: ReturnType<typeof vi.fn> };
  sync_operations: { create: ReturnType<typeof vi.fn> };
};

describe('SalesService — Invariants métier, sécurité BOLA et cas limites', () => {
  let service: SalesService;
  let tx: MockTx;
  let prisma: {
    sales: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
    sync_operations: { findUnique: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };

  const commerceId = '11111111-1111-4111-8111-111111111111';
  const otherCommerceId = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      products: { findFirst: vi.fn() },
      customers: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      sales: { create: vi.fn() },
      stock_movements: { create: vi.fn() },
      sync_operations: { create: vi.fn() },
    };

    prisma = {
      sales: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
      sync_operations: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn(async (callback: (client: MockTx) => Promise<unknown>) => callback(tx)),
    };

    service = new SalesService(prisma as unknown as PrismaService);
  });

  describe('Idempotence hors-ligne et isolation multi-tenant (BOLA)', () => {
    it('retourne la vente existante sans relancer de transaction si client_op_uuid appartient déjà au commerce', async () => {
      const opUuid = '33333333-3333-4333-8333-333333333333';
      const existingSale = { id: opUuid, commerce_id: commerceId, total_amount: 5000 };

      prisma.sync_operations.findUnique.mockResolvedValue({
        client_op_uuid: opUuid,
        commerce_id: commerceId,
        status: SyncStatus.APPLIED,
      });
      prisma.sales.findFirst.mockResolvedValue(existingSale);

      const result = await service.create(commerceId, {
        client_op_uuid: opUuid,
        payment_method: PaymentMethod.CASH,
        amount_paid: 5000,
        lines: [{ product_id: 'prod-1', quantity: 1, unit_label: 'Pièce', unit_price: 5000 }],
      });

      expect(result).toEqual(existingSale);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('ne renvoie jamais la vente d un autre commerce même si client_op_uuid coïncide', async () => {
      const opUuid = '33333333-3333-4333-8333-333333333333';

      prisma.sync_operations.findUnique.mockResolvedValue({
        client_op_uuid: opUuid,
        commerce_id: otherCommerceId,
        status: SyncStatus.APPLIED,
      });
      tx.products.findFirst.mockResolvedValue(null);

      await expect(
        service.create(commerceId, {
          client_op_uuid: opUuid,
          payment_method: PaymentMethod.CASH,
          amount_paid: 5000,
          lines: [{ product_id: 'prod-1', quantity: 1, unit_label: 'Pièce', unit_price: 5000 }],
        }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.sales.findFirst).not.toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('rejette avec NotFoundException si le customer_id appartient à un autre commerce', async () => {
      tx.products.findFirst.mockResolvedValue({
        id: 'prod-1',
        name: 'Riz 25kg',
        default_cost_price: 12000,
        product_units: [{ id: 'u1', label: 'Sac', is_base_unit: true, conversion_factor: 1 }],
        stock_movements: [{ quantity_delta: 10 }],
      });
      tx.customers.findFirst.mockResolvedValue(null);

      await expect(
        service.create(commerceId, {
          customer_id: 'cust-other-tenant',
          payment_method: PaymentMethod.CREDIT,
          amount_paid: 0,
          lines: [{ product_id: 'prod-1', quantity: 1, unit_label: 'Sac', unit_price: 15000 }],
        }),
      ).rejects.toThrow(NotFoundException);

      expect(tx.sales.create).not.toHaveBeenCalled();
    });
  });

  describe('Verrouillage pessimiste, stock cumulé et conversions d unités', () => {
    it('verrouille les produits uniques dans un ordre trié pour prévenir les deadlocks', async () => {
      const prodA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const prodB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

      tx.products.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        name: `Produit ${where.id}`,
        default_cost_price: 500,
        product_units: [{ id: 'u-base', label: 'Pièce', is_base_unit: true, conversion_factor: 1 }],
        stock_movements: [{ quantity_delta: 20 }],
      }));
      tx.sales.create.mockResolvedValue({ id: 'sale-1', status: SaleStatus.COMPLETED });

      await service.create(commerceId, {
        payment_method: PaymentMethod.CASH,
        amount_paid: 3000,
        lines: [
          { product_id: prodB, quantity: 1, unit_label: 'Pièce', unit_price: 1000 },
          { product_id: prodA, quantity: 1, unit_label: 'Pièce', unit_price: 1000 },
          { product_id: prodB, quantity: 1, unit_label: 'Pièce', unit_price: 1000 },
        ],
      });

      expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
      const firstCallArgs = tx.$queryRaw.mock.calls[0];
      const secondCallArgs = tx.$queryRaw.mock.calls[1];
      expect(firstCallArgs[1]).toBe(prodA);
      expect(secondCallArgs[1]).toBe(prodB);
    });

    it('autorise la vente multi-lignes en stock négatif (Règle d Or n°2) et enregistre chaque mouvement de stock', async () => {
      tx.products.findFirst.mockResolvedValue({
        id: 'prod-oil',
        name: 'Huile 1L',
        default_cost_price: 900,
        product_units: [
          { id: 'u-bottle', label: 'Bouteille', is_base_unit: true, conversion_factor: 1 },
          { id: 'u-carton', label: 'Carton', is_base_unit: false, conversion_factor: 12 },
        ],
        stock_movements: [{ quantity_delta: 20 }, { quantity_delta: -5 }], // disponible = 15, requis = 16 -> stock final = -1
      });
      tx.sales.create.mockResolvedValue({ id: 'sale-neg-multi', total_amount: 19000 });

      const result = await service.create(commerceId, {
        payment_method: PaymentMethod.CASH,
        amount_paid: 19000,
        lines: [
          { product_id: 'prod-oil', quantity: 1, unit_label: 'Carton', unit_price: 14000 }, // -12
          { product_id: 'prod-oil', quantity: 4, unit_label: 'Bouteille', unit_price: 1250 }, // -4
        ],
      });

      expect(result).toEqual({ id: 'sale-neg-multi', total_amount: 19000 });
      expect(tx.stock_movements.create).toHaveBeenCalledTimes(2);
      expect(tx.stock_movements.create).toHaveBeenNthCalledWith(1, {
        data: {
          commerce_id: commerceId,
          product_id: 'prod-oil',
          type: StockMovementType.SALE,
          quantity_delta: -12,
          reason: 'Vente comptoir',
        },
      });
      expect(tx.stock_movements.create).toHaveBeenNthCalledWith(2, {
        data: {
          commerce_id: commerceId,
          product_id: 'prod-oil',
          type: StockMovementType.SALE,
          quantity_delta: -4,
          reason: 'Vente comptoir',
        },
      });
    });

    it('rejette une vente à crédit (reste dû > 0) sans client désigné', async () => {
      tx.products.findFirst.mockResolvedValue({
        id: 'prod-1',
        name: 'Sucre 1kg',
        default_cost_price: 600,
        product_units: [{ id: 'u1', label: 'Paquet', is_base_unit: true, conversion_factor: 1 }],
        stock_movements: [{ quantity_delta: 5 }],
      });

      await expect(
        service.create(commerceId, {
          payment_method: PaymentMethod.CASH,
          amount_paid: 500,
          lines: [{ product_id: 'prod-1', quantity: 1, unit_label: 'Paquet', unit_price: 800 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('enregistre la vente, déduit le stock en unité de base, incrémente la dette et trace sync_operations', async () => {
      const opUuid = '44444444-4444-4444-8444-444444444444';
      tx.products.findFirst.mockResolvedValue({
        id: 'prod-soap',
        name: 'Savon',
        default_cost_price: 200,
        product_units: [
          { id: 'u-pack', label: 'Carton', is_base_unit: false, conversion_factor: 6 },
        ],
        stock_movements: [{ quantity_delta: 12 }],
      });
      tx.customers.findFirst.mockResolvedValue({ id: 'cust-1', commerce_id: commerceId });
      tx.sales.create.mockResolvedValue({ id: opUuid, total_amount: 3000, debt_amount: 1000 });

      await service.create(commerceId, {
        client_op_uuid: opUuid,
        customer_id: 'cust-1',
        payment_method: PaymentMethod.CREDIT,
        amount_paid: 2000,
        lines: [{ product_id: 'prod-soap', quantity: 2, unit_label: 'Carton', unit_price: 1500 }],
      });

      expect(tx.stock_movements.create).toHaveBeenCalledWith({
        data: {
          commerce_id: commerceId,
          product_id: 'prod-soap',
          type: StockMovementType.SALE,
          quantity_delta: -12,
          reason: 'Vente comptoir',
        },
      });
      expect(tx.customers.update).toHaveBeenCalledWith({
        where: { id: 'cust-1' },
        data: { outstanding_debt: { increment: 1000 } },
      });
      expect(tx.sync_operations.create).toHaveBeenCalledWith({
        data: {
          client_op_uuid: opUuid,
          commerce_id: commerceId,
          action_type: 'SALE_CREATE',
          status: SyncStatus.APPLIED,
        },
      });
    });
  });

  describe('getSummary — Validation des dates et calculs financiers', () => {
    it('rejette une date invalide ou une plage inversée (startDate > endDate)', async () => {
      await expect(
        service.getSummary(commerceId, { startDate: 'not-a-date' }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.getSummary(commerceId, {
          startDate: '2026-11-25T00:00:00.000Z',
          endDate: '2026-11-20T00:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('calcule exactement le chiffre d affaires, le COGS, la marge brute et le top 10 trié', async () => {
      prisma.sales.findMany.mockResolvedValue([
        {
          total_amount: 15000,
          items: [
            {
              product_id: 'p1',
              quantity: 2,
              conversion_rate_snap: 6,
              cost_price_snapshot: 500,
              unit_price_snapshot: 7500,
              subtotal: 15000,
              product: { id: 'p1', name: 'Carton Lait' },
            },
          ],
        },
        {
          total_amount: 4000,
          items: [
            {
              product_id: 'p2',
              quantity: 4,
              conversion_rate_snap: 1,
              cost_price_snapshot: 700,
              unit_price_snapshot: 1000,
              subtotal: 4000,
              product: { id: 'p2', name: 'Sucre' },
            },
          ],
        },
      ]);

      const summary = await service.getSummary(commerceId);

      expect(summary.total_revenue).toBe(19000);
      expect(summary.cost_of_goods_sold).toBe(8800); // (2*6*500) + (4*1*700)
      expect(summary.gross_profit).toBe(10200);
      expect(summary.top_products.map((p) => p.product_id)).toEqual(['p1', 'p2']);
    });
  });
});
