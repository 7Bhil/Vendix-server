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

  describe('create (Verrouillage concurrent, autorite BDD des unites, anti-survente et paiements)', () => {
    it('devrait refuser une vente sans article', async () => {
      await expect(
        salesService.create(commerceId, {
          payment_method: PaymentMethod.CASH,
          amount_paid: 1000,
          lines: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('devrait poser un verrou FOR UPDATE en base et creer une vente au comptant (CASH) avec snapshots et deduction de stock', async () => {
      const mockProduct = {
        id: 'prod-riz',
        name: 'Riz 50kg',
        commerce_id: commerceId,
        default_cost_price: 18000,
        product_units: [
          { id: 'u-1', label: 'Sac', conversion_factor: 1, retail_price: 20000, is_base_unit: true },
          { id: 'u-2', label: 'Kilo', conversion_factor: 0.02, retail_price: 500, is_base_unit: false },
        ],
        stock_movements: [{ quantity_delta: 10 }],
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
          $queryRaw: vi.fn().mockResolvedValue([{ id: 'prod-riz' }]),
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

        // Vérifie que le verrou en base de données (SELECT ... FOR UPDATE) a bien été posé
        expect(tx.$queryRaw).toHaveBeenCalledTimes(1);

        expect(tx.products.findFirst).toHaveBeenCalledWith({
          where: { id: 'prod-riz', commerce_id: commerceId, is_archived: false },
          include: {
            product_units: true,
            stock_movements: {
              select: { quantity_delta: true },
            },
          },
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

    it('devrait empecher la survente (stock insuffisant) lorsque la quantite demandee depasse le stock disponible', async () => {
      const mockProduct = {
        id: 'prod-dernier',
        name: 'Huile 5L',
        commerce_id: commerceId,
        default_cost_price: 4000,
        product_units: [
          { id: 'u-1', label: 'Bidon', conversion_factor: 1, retail_price: 5000, is_base_unit: true },
        ],
        // Seulement 1 bidon restant en stock
        stock_movements: [{ quantity_delta: 5 }, { quantity_delta: -4 }],
      };

      const dto = {
        payment_method: PaymentMethod.CASH,
        amount_paid: 10000,
        lines: [
          {
            product_id: 'prod-dernier',
            unit_label: 'Bidon',
            quantity: 2, // Demande 2 alors qu'il n'en reste qu'1
            unit_price: 5000,
          },
        ],
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([{ id: 'prod-dernier' }]),
          products: { findFirst: vi.fn().mockResolvedValue(mockProduct) },
          sales: { create: vi.fn() },
          stock_movements: { create: vi.fn() },
        };
        return callback(tx);
      });

      await expect(salesService.create(commerceId, dto)).rejects.toThrow(BadRequestException);
    });

    it('devrait utiliser exclusivement le facteur de conversion de la BDD et retirer exactement 10 unites pour 10 unites de base (jamais 100)', async () => {
      const mockProduct = {
        id: 'prod-savon',
        name: 'Savon',
        commerce_id: commerceId,
        default_cost_price: 200,
        product_units: [
          // Même si conversion_factor en BDD ou envoyé par erreur valait 10 sur l'unité de base, is_base_unit garantit 1
          { id: 'u-base', label: 'Pièce', conversion_factor: 10, retail_price: 250, is_base_unit: true },
          { id: 'u-carton', label: 'Carton de 10', conversion_factor: 10, retail_price: 2400, is_base_unit: false },
        ],
        stock_movements: [{ quantity_delta: 50 }],
      };

      const dto = {
        payment_method: PaymentMethod.CASH,
        amount_paid: 2500,
        lines: [
          {
            product_id: 'prod-savon',
            unit_label: 'Pièce',
            quantity: 10,
            unit_price: 250,
            // Même si un appelant interne passait conversion_factor: 10, il est ignoré
            ...({ conversion_factor: 10 } as Record<string, unknown>),
          },
        ],
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([{ id: 'prod-savon' }]),
          products: { findFirst: vi.fn().mockResolvedValue(mockProduct) },
          sales: { create: vi.fn().mockResolvedValue({ id: 'sale-10-pieces' }) },
          stock_movements: { create: vi.fn() },
          customers: { update: vi.fn() },
        };

        await callback(tx);

        // 10 pièces d'unité de base retirent exactement -10 (et jamais -100)
        expect(tx.stock_movements.create).toHaveBeenCalledWith({
          data: {
            commerce_id: commerceId,
            product_id: 'prod-savon',
            type: StockMovementType.SALE,
            quantity_delta: -10,
            reason: 'Vente comptoir',
          },
        });
      });

      await salesService.create(commerceId, dto);
    });

    it('devrait lever BadRequestException pour une vente a credit sans customer_id', async () => {
      const mockProduct = {
        id: 'prod-riz',
        commerce_id: commerceId,
        default_cost_price: 18000,
        product_units: [{ id: 'u-1', label: 'Sac', conversion_factor: 1, retail_price: 20000, is_base_unit: true }],
        stock_movements: [{ quantity_delta: 10 }],
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
          $queryRaw: vi.fn().mockResolvedValue([{ id: 'prod-riz' }]),
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
        product_units: [{ id: 'u-1', label: 'Sac', conversion_factor: 1, retail_price: 20000, is_base_unit: true }],
        stock_movements: [{ quantity_delta: 10 }],
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
          $queryRaw: vi.fn().mockResolvedValue([{ id: 'prod-riz' }]),
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
        product_units: [{ id: 'u-1', label: 'Carton', conversion_factor: 1, retail_price: 3500, is_base_unit: true }],
        stock_movements: [{ quantity_delta: 20 }],
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
          $queryRaw: vi.fn().mockResolvedValue([{ id: 'prod-lait' }]),
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

    it('devrait deduire le stock selon le conversion_factor de la BDD pour une unite derivee (Carton)', async () => {
      const mockProduct = {
        id: 'prod-carton',
        commerce_id: commerceId,
        default_cost_price: 500,
        product_units: [
          { id: 'u-1', label: 'Pièce', conversion_factor: 1, retail_price: 600, is_base_unit: true },
          { id: 'u-2', label: 'Carton de 24', conversion_factor: 24, retail_price: 14000, is_base_unit: false },
        ],
        stock_movements: [{ quantity_delta: 100 }],
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
          },
        ],
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([{ id: 'prod-carton' }]),
          products: { findFirst: vi.fn().mockResolvedValue(mockProduct) },
          sales: {
            create: vi.fn().mockResolvedValue({ id: 'sale-derived-unit' }),
          },
          stock_movements: { create: vi.fn() },
          customers: { update: vi.fn() },
        };

        await callback(tx);

        // 2 cartons x 24 (issu de la BDD) = 48 pieces deduites
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
