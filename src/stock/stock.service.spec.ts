import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { StockMovementType } from '@prisma/client';
import { StockService } from './stock.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ManualStockMotif, StockLevel } from './dto/stock.dto.js';

describe('StockService', () => {
  let stockService: StockService;

  const mockPrismaService = {
    products: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    stock_movements: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    sync_operations: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  const commerceId = 'commerce-uuid-1';
  const otherCommerceId = 'commerce-uuid-2';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    stockService = module.get<StockService>(StockService);
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(stockService).toBeDefined();
  });

  describe('getStockState (GET /api/v1/stock)', () => {
    const sampleProducts = [
      {
        id: 'prod-normal',
        commerce_id: commerceId,
        name: 'Riz Parfumé 50kg',
        is_archived: false,
        category: { id: 'cat-1', name: 'Céréales' },
        product_units: [{ id: 'u-1', label: 'Sac', conversion_factor: 1, retail_price: 25000, is_base_unit: true }],
        stock_movements: [{ quantity_delta: 20 }, { quantity_delta: -5 }], // 15 -> NORMAL
      },
      {
        id: 'prod-low',
        commerce_id: commerceId,
        name: 'Huile Arachide',
        is_archived: false,
        category: { id: 'cat-2', name: 'Huiles' },
        product_units: [{ id: 'u-2', label: 'Litre', conversion_factor: 1, retail_price: 1200, is_base_unit: true }],
        stock_movements: [{ quantity_delta: 10 }, { quantity_delta: -7 }], // 3 -> LOW (<= 5)
      },
      {
        id: 'prod-out',
        commerce_id: commerceId,
        name: 'Sucre en morceaux',
        is_archived: false,
        category: { id: 'cat-3', name: 'Épicerie' },
        product_units: [{ id: 'u-3', label: 'Paquet', conversion_factor: 1, retail_price: 600, is_base_unit: true }],
        stock_movements: [{ quantity_delta: 5 }, { quantity_delta: -5 }], // 0 -> OUT_OF_STOCK
      },
    ];

    it('devrait retourner l etat global du stock avec les niveaux NORMAL, LOW et OUT_OF_STOCK', async () => {
      mockPrismaService.products.findMany.mockResolvedValueOnce(sampleProducts);

      const result = await stockService.getStockState(commerceId);

      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({
        id: 'prod-normal',
        current_stock: 15,
        currentStock: 15,
        stock_level: StockLevel.NORMAL,
      });
      expect(result[1]).toMatchObject({
        id: 'prod-low',
        current_stock: 3,
        currentStock: 3,
        stock_level: StockLevel.LOW,
      });
      expect(result[2]).toMatchObject({
        id: 'prod-out',
        current_stock: 0,
        currentStock: 0,
        stock_level: StockLevel.OUT_OF_STOCK,
      });
    });

    it('devrait filtrer uniquement les produits au niveau LOW', async () => {
      mockPrismaService.products.findMany.mockResolvedValueOnce(sampleProducts);

      const lowItems = await stockService.getStockState(commerceId, { level: 'LOW' });

      expect(lowItems).toHaveLength(1);
      expect(lowItems[0].id).toBe('prod-low');
      expect(lowItems[0].stock_level).toBe(StockLevel.LOW);
    });

    it('devrait filtrer uniquement les produits en rupture (OUT_OF_STOCK)', async () => {
      mockPrismaService.products.findMany.mockResolvedValueOnce(sampleProducts);

      const outItems = await stockService.getStockState(commerceId, { level: 'OUT_OF_STOCK' });

      expect(outItems).toHaveLength(1);
      expect(outItems[0].id).toBe('prod-out');
      expect(outItems[0].stock_level).toBe(StockLevel.OUT_OF_STOCK);
    });

    it('devrait lever BadRequestException si le filtre de niveau est invalide', async () => {
      await expect(
        stockService.getStockState(commerceId, { level: 'INVALID_LEVEL' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('recordMovement (POST /api/v1/stock/movements - Transaction ACID)', () => {
    it('devrait enregistrer un mouvement ENTRY (Entree de marchandise) et augmenter currentStock dans une transaction ACID', async () => {
      const mockProduct = {
        id: 'prod-1',
        commerce_id: commerceId,
        name: 'Savon',
        is_archived: false,
        product_units: [{ id: 'u-1', label: 'Pièce', conversion_factor: 1, is_base_unit: true }],
        stock_movements: [{ quantity_delta: 10 }],
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          products: {
            findFirst: vi.fn().mockResolvedValue(mockProduct),
            update: vi.fn().mockResolvedValue(mockProduct),
          },
          stock_movements: {
            create: vi.fn().mockResolvedValue({
              id: 'sm-entry-1',
              commerce_id: commerceId,
              product_id: 'prod-1',
              type: StockMovementType.PURCHASE_ENTRY,
              quantity_delta: 25,
              reason: 'Livraison fournisseur',
            }),
          },
        };

        const res = await callback(tx);

        expect(tx.stock_movements.create).toHaveBeenCalledWith({
          data: {
            id: undefined,
            commerce_id: commerceId,
            product_id: 'prod-1',
            type: StockMovementType.PURCHASE_ENTRY,
            quantity_delta: 25,
            reason: 'Livraison fournisseur',
          },
        });
        expect(tx.products.update).toHaveBeenCalledWith({
          where: { id: 'prod-1' },
          data: { updated_at: expect.any(Date) },
        });

        return res;
      });

      const result = await stockService.recordMovement(commerceId, {
        product_id: 'prod-1',
        motif: ManualStockMotif.ENTRY,
        quantity: 25,
        reason: 'Livraison fournisseur',
      });

      expect(result.motif).toBe(ManualStockMotif.ENTRY);
      expect(result.previous_stock).toBe(10);
      expect(result.current_stock).toBe(35);
      expect(result.currentStock).toBe(35);
    });

    it('devrait enregistrer un mouvement LOSS (Perte / Casse / Avarie) et deduire currentStock', async () => {
      const mockProduct = {
        id: 'prod-1',
        commerce_id: commerceId,
        name: 'Bouteille Huile',
        is_archived: false,
        product_units: [{ id: 'u-1', label: 'Bouteille', conversion_factor: 1, is_base_unit: true }],
        stock_movements: [{ quantity_delta: 12 }],
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          products: {
            findFirst: vi.fn().mockResolvedValue(mockProduct),
            update: vi.fn().mockResolvedValue(mockProduct),
          },
          stock_movements: {
            create: vi.fn().mockResolvedValue({
              id: 'sm-loss-1',
              commerce_id: commerceId,
              product_id: 'prod-1',
              type: StockMovementType.INVENTORY_LOSS,
              quantity_delta: -2,
              reason: 'Bouteilles cassées',
            }),
          },
        };

        return callback(tx);
      });

      const result = await stockService.recordMovement(commerceId, {
        product_id: 'prod-1',
        type: ManualStockMotif.LOSS,
        quantity: 2,
        reason: 'Bouteilles cassées',
      });

      expect(result.motif).toBe(ManualStockMotif.LOSS);
      expect(result.quantity_delta).toBe(-2);
      expect(result.previous_stock).toBe(12);
      expect(result.current_stock).toBe(10);
      expect(result.currentStock).toBe(10);
    });

    it('devrait enregistrer un mouvement CORRECTION (Ajustement inventaire) positif ou negatif', async () => {
      const mockProduct = {
        id: 'prod-1',
        commerce_id: commerceId,
        name: 'Farine',
        is_archived: false,
        product_units: [{ id: 'u-1', label: 'Kg', conversion_factor: 1, is_base_unit: true }],
        stock_movements: [{ quantity_delta: 20 }],
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          products: {
            findFirst: vi.fn().mockResolvedValue(mockProduct),
            update: vi.fn().mockResolvedValue(mockProduct),
          },
          stock_movements: {
            create: vi.fn().mockResolvedValue({
              id: 'sm-corr-1',
              commerce_id: commerceId,
              product_id: 'prod-1',
              type: StockMovementType.MANUAL_ADJUST,
              quantity_delta: -3,
              reason: 'Ajustement inventaire',
            }),
          },
        };

        return callback(tx);
      });

      const result = await stockService.recordMovement(commerceId, {
        product_id: 'prod-1',
        motif: ManualStockMotif.CORRECTION,
        quantity: -3,
      });

      expect(result.motif).toBe(ManualStockMotif.CORRECTION);
      expect(result.quantity_delta).toBe(-3);
      expect(result.currentStock).toBe(17);
    });

    it('devrait refuser un mouvement si le motif est manquant ou invalide (ex: SALE manuel)', async () => {
      await expect(
        stockService.recordMovement(commerceId, {
          product_id: 'prod-1',
          quantity: 5,
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        stockService.recordMovement(commerceId, {
          product_id: 'prod-1',
          motif: 'SALE',
          quantity: 5,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('devrait refuser une perte (LOSS) qui rendrait le stock negatif', async () => {
      const mockProduct = {
        id: 'prod-1',
        commerce_id: commerceId,
        name: 'Lait',
        is_archived: false,
        product_units: [],
        stock_movements: [{ quantity_delta: 3 }],
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          products: {
            findFirst: vi.fn().mockResolvedValue(mockProduct),
            update: vi.fn(),
          },
          stock_movements: { create: vi.fn() },
        };
        return callback(tx);
      });

      await expect(
        stockService.recordMovement(commerceId, {
          product_id: 'prod-1',
          motif: ManualStockMotif.LOSS,
          quantity: 5,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('devrait lever NotFoundException si le produit appartient a un autre commerce (BOLA)', async () => {
      mockPrismaService.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          products: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
        };
        return callback(tx);
      });

      await expect(
        stockService.recordMovement(otherCommerceId, {
          product_id: 'prod-1',
          motif: ManualStockMotif.ENTRY,
          quantity: 10,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getMovementsHistory (GET /api/v1/stock/movements)', () => {
    it('devrait retourner l historique chronologique pagine et filtre par produit', async () => {
      const mockMovements = [
        {
          id: 'sm-1',
          commerce_id: commerceId,
          product_id: 'prod-1',
          type: StockMovementType.SALE,
          quantity_delta: -2,
          reason: 'Vente comptoir',
          created_at: new Date(),
          product: { id: 'prod-1', name: 'Riz' },
        },
      ];

      mockPrismaService.stock_movements.findMany.mockResolvedValueOnce(mockMovements);
      mockPrismaService.stock_movements.count.mockResolvedValueOnce(1);

      const result = await stockService.getMovementsHistory(commerceId, {
        productId: 'prod-1',
        page: 1,
        limit: 10,
      });

      expect(mockPrismaService.stock_movements.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            commerce_id: commerceId,
            product_id: 'prod-1',
          },
          orderBy: { created_at: 'desc' },
          skip: 0,
          take: 10,
        }),
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0].motif).toBe('SALE');
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
    });
  });

  describe('getStockAlerts (GET /api/v1/stock/alerts)', () => {
    it('devrait retourner uniquement les produits sous le seuil d alerte tries par criticite', async () => {
      const sampleProducts = [
        {
          id: 'prod-normal',
          commerce_id: commerceId,
          name: 'Riz',
          is_archived: false,
          category: null,
          product_units: [],
          stock_movements: [{ quantity_delta: 20 }],
        },
        {
          id: 'prod-low',
          commerce_id: commerceId,
          name: 'Huile',
          is_archived: false,
          category: null,
          product_units: [],
          stock_movements: [{ quantity_delta: 3 }],
        },
        {
          id: 'prod-out',
          commerce_id: commerceId,
          name: 'Sucre',
          is_archived: false,
          category: null,
          product_units: [],
          stock_movements: [{ quantity_delta: 0 }],
        },
      ];

      mockPrismaService.products.findMany.mockResolvedValueOnce(sampleProducts);

      const alerts = await stockService.getStockAlerts(commerceId, 5);

      expect(alerts).toHaveLength(2);
      expect(alerts[0].id).toBe('prod-out');
      expect(alerts[0].stock_level).toBe(StockLevel.OUT_OF_STOCK);
      expect(alerts[0].deficit).toBe(5);
      expect(alerts[1].id).toBe('prod-low');
      expect(alerts[1].stock_level).toBe(StockLevel.LOW);
      expect(alerts[1].deficit).toBe(2);
    });
  });

  describe('Immuabilite de l historique (deleteMovement)', () => {
    it('devrait interdire toute suppression de mouvement de stock avec ForbiddenException', async () => {
      await expect(
        stockService.deleteMovement(commerceId, 'sm-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});

