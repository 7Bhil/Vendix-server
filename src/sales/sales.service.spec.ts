import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PaymentMethod, SaleStatus, StockMovementType } from '@prisma/client';
import { SalesService } from './sales.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('SalesService', () => {
  let salesService: SalesService;

  const mockPrismaService = {
    sales: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    sync_operations: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  const commerceId = 'commerce-uuid-1';
  const otherCommerceId = 'commerce-uuid-2';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    salesService = module.get<SalesService>(SalesService);
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(salesService).toBeDefined();
  });

  describe('findAll and findOne (Tenant Isolation - BOLA)', () => {
    it('devrait retourner les ventes d un commerce', async () => {
      const mockSales = [{ id: 'sale-1', commerce_id: commerceId, total_amount: 5000 }];
      mockPrismaService.sales.findMany.mockResolvedValueOnce(mockSales);

      const result = await salesService.findAll(commerceId, 20);

      expect(mockPrismaService.sales.findMany).toHaveBeenCalledWith({
        where: { commerce_id: commerceId },
        include: {
          customer: true,
          items: {
            include: {
              product: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
        take: 20,
      });
      expect(result).toEqual(mockSales);
    });

    it('devrait retourner une vente existante du commerce', async () => {
      const mockSale = { id: 'sale-1', commerce_id: commerceId, total_amount: 5000 };
      mockPrismaService.sales.findFirst.mockResolvedValueOnce(mockSale);

      const result = await salesService.findOne(commerceId, 'sale-1');
      expect(result).toEqual(mockSale);
    });

    it('devrait lever NotFoundException si la vente n appartient pas au commerce (BOLA)', async () => {
      mockPrismaService.sales.findFirst.mockResolvedValueOnce(null);

      await expect(
        salesService.findOne(otherCommerceId, 'sale-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('create (Calcul du total, snapshots, deduction de stock et modes de paiement)', () => {
    it('devrait refuser une vente sans article', async () => {
      await expect(
        salesService.create(commerceId, {
          payment_method: PaymentMethod.CASH,
          amount_paid: 1000,
          lines: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('devrait creer une vente au comptant (Full payment CASH) avec snapshots et deduction de stock', async () => {
      const mockProduct = {
        id: 'prod-riz',
        commerce_id: commerceId,
        default_cost_price: 18000,
        product_units: [
          { id: 'u-1', label: 'Sac', conversion_factor: 1, retail_price: 20000 },
          { id: 'u-2', label: 'Kilo', conversion_factor: 0.02, retail_price: 500 },
        ],
      };

      const dto = {
        payment_method: PaymentMethod.CASH,
        amount_paid: 20000,
        lines: [
          {
            product_id: 'prod-riz',
            unit_label: 'Sac',
            quantity: 1,
            unit_price: 20000,
            conversion_factor: 1,
          },
        ],
      };

      const createdSale = {
        id: 'sale-full-cash',
        commerce_id: commerceId,
        total_amount: 20000,
        amount_paid: 20000,
        debt_amount: 0,
        payment_method: PaymentMethod.CASH,
        status: SaleStatus.COMPLETED,
        items: [
          {
            product_id: 'prod-riz',
            quantity: 1,
            unit_label_snapshot: 'Sac',
            conversion_rate_snap: 1,
            unit_price_snapshot: 20000,
            cost_price_snapshot: 18000,
            subtotal: 20000,
          },
        ],
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          products: {
            findFirst: vi.fn().mockResolvedValue(mockProduct),
          },
          sales: {
            create: vi.fn().mockResolvedValue(createdSale),
          },
          stock_movements: {
            create: vi.fn().mockResolvedValue({ id: 'sm-deduct-1' }),
          },
          customers: {
            update: vi.fn(),
          },
        };

        const res = await callback(tx);

        expect(tx.products.findFirst).toHaveBeenCalledWith({
          where: { id: 'prod-riz', commerce_id: commerceId, is_archived: false },
          include: { product_units: true },
        });

        // Verification des snapshots dans la creation de vente
        expect(tx.sales.create).toHaveBeenCalledWith({
          data: {
            id: undefined,
            commerce_id: commerceId,
            customer_id: null,
            total_amount: 20000,
            amount_paid: 20000,
            debt_amount: 0,
            payment_method: PaymentMethod.CASH,
            status: SaleStatus.COMPLETED,
            items: {
              create: [
                {
                  product_id: 'prod-riz',
                  quantity: 1,
                  unit_label_snapshot: 'Sac',
                  conversion_rate_snap: 1,
                  unit_price_snapshot: 20000,
                  cost_price_snapshot: 18000,
                  subtotal: 20000,
                },
              ],
            },
          },
          include: { customer: true, items: true },
        });

        // Verification de la deduction de stock
        expect(tx.stock_movements.create).toHaveBeenCalledWith({
          data: {
            commerce_id: commerceId,
            product_id: 'prod-riz',
            type: StockMovementType.SALE,
            quantity_delta: -1,
            reason: 'Vente comptoir',
          },
        });

        // Aucun encours client credite car dette = 0
        expect(tx.customers.update).not.toHaveBeenCalled();

        return res;
      });

      const result = await salesService.create(commerceId, dto);
      expect(result).toEqual(createdSale);
    });

    it('devrait lever BadRequestException pour une vente a credit sans customer_id', async () => {
      const mockProduct = {
        id: 'prod-riz',
        commerce_id: commerceId,
        default_cost_price: 18000,
        product_units: [{ id: 'u-1', label: 'Sac', conversion_factor: 1, retail_price: 20000 }],
      };

      const dto = {
        payment_method: PaymentMethod.CREDIT,
        amount_paid: 0,
        lines: [
          {
            product_id: 'prod-riz',
            unit_label: 'Sac',
            quantity: 1,
            unit_price: 20000,
          },
        ],
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          products: { findFirst: vi.fn().mockResolvedValue(mockProduct) },
        };
        return callback(tx);
      });

      await expect(salesService.create(commerceId, dto)).rejects.toThrow(BadRequestException);
    });

    it('devrait gerer une vente a paiement partiel (Split / Acompte) et incrementer la dette client', async () => {
      const mockProduct = {
        id: 'prod-riz',
        commerce_id: commerceId,
        default_cost_price: 15000,
        product_units: [{ id: 'u-1', label: 'Sac', conversion_factor: 1, retail_price: 20000 }],
      };

      const dto = {
        customer_id: 'cust-123',
        payment_method: PaymentMethod.SPLIT,
        amount_paid: 8000,
        lines: [
          {
            product_id: 'prod-riz',
            unit_label: 'Sac',
            quantity: 1,
            unit_price: 20000,
          },
        ],
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          products: { findFirst: vi.fn().mockResolvedValue(mockProduct) },
          sales: {
            create: vi.fn().mockResolvedValue({
              id: 'sale-split',
              total_amount: 20000,
              amount_paid: 8000,
              debt_amount: 12000,
            }),
          },
          stock_movements: { create: vi.fn() },
          customers: { update: vi.fn().mockResolvedValue({}) },
        };

        const res = await callback(tx);

        expect(tx.sales.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              total_amount: 20000,
              amount_paid: 8000,
              debt_amount: 12000,
              customer_id: 'cust-123',
            }),
          }),
        );

        // Verification de l incrementation de la dette du client
        expect(tx.customers.update).toHaveBeenCalledWith({
          where: { id: 'cust-123' },
          data: {
            outstanding_debt: { increment: 12000 },
          },
        });

        return res;
      });

      const res = await salesService.create(commerceId, dto);
      expect(res.debt_amount).toBe(12000);
    });

    it('devrait gerer une vente a credit total (Credit) avec client', async () => {
      const mockProduct = {
        id: 'prod-lait',
        commerce_id: commerceId,
        default_cost_price: 2000,
        product_units: [{ id: 'u-1', label: 'Carton', conversion_factor: 1, retail_price: 3500 }],
      };

      const dto = {
        customer_id: 'cust-456',
        payment_method: PaymentMethod.CREDIT,
        amount_paid: 0,
        lines: [
          {
            product_id: 'prod-lait',
            unit_label: 'Carton',
            quantity: 2,
            unit_price: 3500,
          },
        ],
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          products: { findFirst: vi.fn().mockResolvedValue(mockProduct) },
          sales: {
            create: vi.fn().mockResolvedValue({
              id: 'sale-credit-total',
              total_amount: 7000,
              amount_paid: 0,
              debt_amount: 7000,
            }),
          },
          stock_movements: { create: vi.fn() },
          customers: { update: vi.fn().mockResolvedValue({}) },
        };

        const res = await callback(tx);

        expect(tx.customers.update).toHaveBeenCalledWith({
          where: { id: 'cust-456' },
          data: {
            outstanding_debt: { increment: 7000 },
          },
        });

        return res;
      });

      const res = await salesService.create(commerceId, dto);
      expect(res.debt_amount).toBe(7000);
    });

    it('devrait deduire le stock selon le conversionFactor pour une unite derivee', async () => {
      const mockProduct = {
        id: 'prod-carton',
        commerce_id: commerceId,
        default_cost_price: 500,
        product_units: [
          { id: 'u-1', label: 'Pièce', conversion_factor: 1, retail_price: 600 },
          { id: 'u-2', label: 'Carton de 24', conversion_factor: 24, retail_price: 14000 },
        ],
      };

      const dto = {
        payment_method: PaymentMethod.MOMO,
        amount_paid: 28000,
        lines: [
          {
            product_id: 'prod-carton',
            unit_label: 'Carton de 24',
            quantity: 2,
            unit_price: 14000,
            conversion_factor: 24,
          },
        ],
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          products: { findFirst: vi.fn().mockResolvedValue(mockProduct) },
          sales: {
            create: vi.fn().mockResolvedValue({ id: 'sale-derived-unit' }),
          },
          stock_movements: { create: vi.fn() },
          customers: { update: vi.fn() },
        };

        await callback(tx);

        // 2 cartons x 24 = 48 pieces deduites
        expect(tx.stock_movements.create).toHaveBeenCalledWith({
          data: {
            commerce_id: commerceId,
            product_id: 'prod-carton',
            type: StockMovementType.SALE,
            quantity_delta: -48,
            reason: 'Vente comptoir',
          },
        });
      });

      await salesService.create(commerceId, dto);
    });

    it('devrait retourner la vente existante si l operation sync idempotente existe deja', async () => {
      const clientOpUuid = 'op-uuid-123';
      mockPrismaService.sync_operations.findUnique.mockResolvedValueOnce({
        client_op_uuid: clientOpUuid,
        commerce_id: commerceId,
      });
      const existingSale = { id: clientOpUuid, commerce_id: commerceId, total_amount: 10000 };
      mockPrismaService.sales.findFirst.mockResolvedValueOnce(existingSale);

      const result = await salesService.create(commerceId, {
        client_op_uuid: clientOpUuid,
        payment_method: PaymentMethod.CASH,
        amount_paid: 10000,
        lines: [{ product_id: 'p1', unit_label: 'u', quantity: 1, unit_price: 10000 }],
      });

      expect(result).toEqual(existingSale);
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });
  });
});
