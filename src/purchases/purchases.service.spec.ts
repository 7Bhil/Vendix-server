import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  PaymentMethod,
  PurchaseStatus,
  StockMovementType,
} from '@prisma/client';
import { PurchasesService } from './purchases.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('PurchasesService', () => {
  let purchasesService: PurchasesService;

  const mockPrismaService = {
    purchases: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    sync_operations: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  const commerceId = 'commerce-uuid-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchasesService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    purchasesService = module.get<PurchasesService>(PurchasesService);
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(purchasesService).toBeDefined();
  });

  describe('create', () => {
    it('devrait refuser une commande d achat sans ligne de produit', async () => {
      await expect(
        purchasesService.create(commerceId, {
          supplier_id: 'sup-1',
          payment_method: PaymentMethod.CASH,
          amount_paid: 10000,
          lines: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('devrait incrementer automatiquement le stock et creer un mouvement PURCHASE quand le statut est RECEIVED', async () => {
      const mockSupplier = {
        id: 'sup-1',
        commerce_id: commerceId,
        name: 'Grossiste Central',
      };

      const mockProduct = {
        id: 'prod-huile',
        commerce_id: commerceId,
        default_cost_price: 12000,
        product_units: [
          { id: 'u-1', label: 'Bidon 25L', conversion_factor: 1, retail_price: 15000 },
        ],
      };

      interface MockTx {
        suppliers: {
          findFirst: ReturnType<typeof vi.fn>;
          update: ReturnType<typeof vi.fn>;
        };
        products: { findFirst: ReturnType<typeof vi.fn> };
        purchases: { create: ReturnType<typeof vi.fn> };
        stock_movements: { create: ReturnType<typeof vi.fn> };
      }

      mockPrismaService.$transaction.mockImplementation(
        async (callback: (tx: MockTx) => Promise<unknown>) => {
          const tx: MockTx = {
            suppliers: {
              findFirst: vi.fn().mockResolvedValue(mockSupplier),
              update: vi.fn().mockResolvedValue({}),
            },
            products: {
              findFirst: vi.fn().mockResolvedValue(mockProduct),
            },
            purchases: {
              create: vi.fn().mockResolvedValue({
                id: 'pur-received-1',
                commerce_id: commerceId,
                supplier_id: 'sup-1',
                total_cost: 60000,
                amount_paid: 20000,
                debt_amount: 40000,
                payment_method: PaymentMethod.SPLIT,
                status: PurchaseStatus.RECEIVED,
                items: [],
              }),
            },
            stock_movements: {
              create: vi.fn().mockResolvedValue({ id: 'sm-pur-1' }),
            },
          };

          const res = await callback(tx);

          // Vérification du mouvement de stock PURCHASE
          expect(tx.stock_movements.create).toHaveBeenCalledWith({
            data: {
              commerce_id: commerceId,
              product_id: 'prod-huile',
              type: StockMovementType.PURCHASE,
              quantity_delta: 5,
              reason: 'Réception commande fournisseur (Grossiste Central)',
            },
          });

          // Vérification de la mise à jour de la dette fournisseur (Acompte: total 60000, payé 20000 => dette 40000)
          expect(tx.suppliers.update).toHaveBeenCalledWith({
            where: { id: 'sup-1' },
            data: {
              outstanding_debt: { increment: 40000 },
            },
          });

          return res;
        },
      );

      const result = await purchasesService.create(commerceId, {
        supplier_id: 'sup-1',
        payment_method: PaymentMethod.SPLIT,
        amount_paid: 20000,
        status: PurchaseStatus.RECEIVED,
        lines: [
          {
            product_id: 'prod-huile',
            unit_label: 'Bidon 25L',
            quantity: 5,
            unit_cost: 12000,
          },
        ],
      });

      expect(result.status).toBe(PurchaseStatus.RECEIVED);
      expect(result.debt_amount).toBe(40000);
    });

    it('ne devrait PAS creer de mouvement de stock si la commande est en statut PENDING', async () => {
      const mockSupplier = {
        id: 'sup-1',
        commerce_id: commerceId,
        name: 'Grossiste Central',
      };

      const mockProduct = {
        id: 'prod-huile',
        commerce_id: commerceId,
        default_cost_price: 12000,
        product_units: [
          { id: 'u-1', label: 'Bidon 25L', conversion_factor: 1, retail_price: 15000 },
        ],
      };

      interface MockTx {
        suppliers: {
          findFirst: ReturnType<typeof vi.fn>;
          update: ReturnType<typeof vi.fn>;
        };
        products: { findFirst: ReturnType<typeof vi.fn> };
        purchases: { create: ReturnType<typeof vi.fn> };
        stock_movements: { create: ReturnType<typeof vi.fn> };
      }

      mockPrismaService.$transaction.mockImplementation(
        async (callback: (tx: MockTx) => Promise<unknown>) => {
          const tx: MockTx = {
            suppliers: {
              findFirst: vi.fn().mockResolvedValue(mockSupplier),
              update: vi.fn().mockResolvedValue({}),
            },
            products: {
              findFirst: vi.fn().mockResolvedValue(mockProduct),
            },
            purchases: {
              create: vi.fn().mockResolvedValue({
                id: 'pur-pending-1',
                commerce_id: commerceId,
                supplier_id: 'sup-1',
                total_cost: 24000,
                amount_paid: 0,
                debt_amount: 24000,
                payment_method: PaymentMethod.CREDIT,
                status: PurchaseStatus.PENDING,
                items: [],
              }),
            },
            stock_movements: {
              create: vi.fn(),
            },
          };

          const res = await callback(tx);

          // Pas de mouvement de stock en statut PENDING
          expect(tx.stock_movements.create).not.toHaveBeenCalled();

          // Dette fournisseur incrémentée
          expect(tx.suppliers.update).toHaveBeenCalledWith({
            where: { id: 'sup-1' },
            data: {
              outstanding_debt: { increment: 24000 },
            },
          });

          return res;
        },
      );

      const result = await purchasesService.create(commerceId, {
        supplier_id: 'sup-1',
        payment_method: PaymentMethod.CREDIT,
        amount_paid: 0,
        status: PurchaseStatus.PENDING,
        lines: [
          {
            product_id: 'prod-huile',
            unit_label: 'Bidon 25L',
            quantity: 2,
            unit_cost: 12000,
          },
        ],
      });

      expect(result.status).toBe(PurchaseStatus.PENDING);
    });

    it('devrait lever NotFoundException si le fournisseur n appartient pas au commerce', async () => {
      interface MockTx {
        suppliers: { findFirst: ReturnType<typeof vi.fn> };
      }

      mockPrismaService.$transaction.mockImplementation(
        async (callback: (tx: MockTx) => Promise<unknown>) => {
          const tx: MockTx = {
            suppliers: {
              findFirst: vi.fn().mockResolvedValue(null),
            },
          };
          return callback(tx);
        },
      );

      await expect(
        purchasesService.create(commerceId, {
          supplier_id: 'sup-other-tenant',
          payment_method: PaymentMethod.CASH,
          amount_paid: 10000,
          lines: [
            {
              product_id: 'prod-1',
              unit_label: 'Unité',
              quantity: 1,
              unit_cost: 10000,
            },
          ],
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

