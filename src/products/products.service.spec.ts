import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { StockMovementType } from '@prisma/client';
import { ProductsService } from './products.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('ProductsService', () => {
  let productsService: ProductsService;

  const mockPrismaService = {
    products: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    product_units: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    stock_movements: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  const commerceId = 'commerce-uuid-1';
  const otherCommerceId = 'commerce-uuid-2';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    productsService = module.get<ProductsService>(ProductsService);
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(productsService).toBeDefined();
  });

  describe('findAll', () => {
    it('devrait retourner les produits non archives avec calcul du stock courant', async () => {
      const mockProductsFromDb = [
        {
          id: 'prod-1',
          commerce_id: commerceId,
          name: 'Riz 50kg',
          is_archived: false,
          category: { id: 'cat-1', name: 'Vivres' },
          product_units: [{ id: 'u-1', label: 'Sac', conversion_factor: 1, retail_price: 25000 }],
          stock_movements: [
            { quantity_delta: 20 },
            { quantity_delta: -5 },
          ],
        },
      ];
      mockPrismaService.products.findMany.mockResolvedValueOnce(mockProductsFromDb);

      const result = await productsService.findAll(commerceId, { search: 'riz' });

      expect(mockPrismaService.products.findMany).toHaveBeenCalledWith({
        where: {
          commerce_id: commerceId,
          is_archived: false,
          name: {
            contains: 'riz',
            mode: 'insensitive',
          },
        },
        include: {
          category: true,
          product_units: {
            orderBy: { conversion_factor: 'asc' },
          },
          stock_movements: {
            select: { quantity_delta: true },
          },
        },
        orderBy: { created_at: 'desc' },
      });

      expect(result).toEqual([
        {
          id: 'prod-1',
          commerce_id: commerceId,
          name: 'Riz 50kg',
          is_archived: false,
          category: { id: 'cat-1', name: 'Vivres' },
          product_units: [{ id: 'u-1', label: 'Sac', conversion_factor: 1, retail_price: 25000 }],
          current_stock: 15,
        },
      ]);
    });
  });

  describe('findOne (Tenant Isolation - BOLA)', () => {
    it('devrait retourner le produit d un commerce donne avec son stock calcule', async () => {
      const mockProduct = {
        id: 'prod-1',
        commerce_id: commerceId,
        name: 'Savon',
        is_archived: false,
        stock_movements: [
          { quantity_delta: 50 },
          { quantity_delta: -10 },
        ],
        product_units: [],
      };
      mockPrismaService.products.findFirst.mockResolvedValueOnce(mockProduct);

      const result = await productsService.findOne(commerceId, 'prod-1');

      expect(mockPrismaService.products.findFirst).toHaveBeenCalledWith({
        where: { id: 'prod-1', commerce_id: commerceId, is_archived: false },
        include: {
          category: true,
          product_units: {
            orderBy: { conversion_factor: 'asc' },
          },
          stock_movements: {
            orderBy: { created_at: 'desc' },
            take: 20,
          },
        },
      });
      expect(result.id).toBe('prod-1');
      expect(result.current_stock).toBe(40);
    });

    it('devrait lever NotFoundException si le produit appartient a un autre commerce (BOLA)', async () => {
      mockPrismaService.products.findFirst.mockResolvedValueOnce(null);

      await expect(
        productsService.findOne(otherCommerceId, 'prod-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('create (Multiples unites et facteurs de conversion)', () => {
    it('devrait refuser la creation si aucune unite n est fournie', async () => {
      await expect(
        productsService.create(commerceId, {
          name: 'Produit sans unite',
          units: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('devrait creer un produit avec unites multiples, facteur de conversion et mouvement initial de stock', async () => {
      const dto = {
        name: 'Huile Végétale',
        default_cost_price: 15000,
        initial_stock: 10,
        units: [
          { label: 'Bouteille', conversion_factor: 1, retail_price: 1000, is_base_unit: true },
          { label: 'Carton', conversion_factor: 15, retail_price: 14000, wholesale_price: 13500 },
        ],
      };

      const createdProduct = {
        id: 'prod-oil',
        commerce_id: commerceId,
        name: 'Huile Végétale',
        default_cost_price: 15000,
        product_units: [
          { id: 'u-1', label: 'Bouteille', conversion_factor: 1, retail_price: 1000, is_base_unit: true },
          { id: 'u-2', label: 'Carton', conversion_factor: 15, retail_price: 14000, wholesale_price: 13500, is_base_unit: false },
        ],
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          products: {
            create: vi.fn().mockResolvedValue(createdProduct),
          },
          stock_movements: {
            create: vi.fn().mockResolvedValue({ id: 'sm-1' }),
          },
        };
        const res = await callback(tx);
        expect(tx.products.create).toHaveBeenCalledWith({
          data: {
            commerce_id: commerceId,
            category_id: undefined,
            name: 'Huile Végétale',
            image_url: undefined,
            default_cost_price: 15000,
            is_visible_public: true,
            product_units: {
              create: [
                {
                  label: 'Bouteille',
                  conversion_factor: 1,
                  retail_price: 1000,
                  wholesale_price: undefined,
                  is_base_unit: true,
                },
                {
                  label: 'Carton',
                  conversion_factor: 15,
                  retail_price: 14000,
                  wholesale_price: 13500,
                  is_base_unit: false,
                },
              ],
            },
          },
          include: {
            product_units: true,
          },
        });
        expect(tx.stock_movements.create).toHaveBeenCalledWith({
          data: {
            commerce_id: commerceId,
            product_id: 'prod-oil',
            type: StockMovementType.PURCHASE_ENTRY,
            quantity_delta: 10,
            reason: 'Stock initial à la création du produit',
          },
        });
        return res;
      });

      const result = await productsService.create(commerceId, dto);
      expect(result).toEqual(createdProduct);
    });

    it('devrait assigner par defaut la premiere unite comme base si non explicitee', async () => {
      const dto = {
        name: 'Sucre en poudre',
        units: [
          { label: 'Kilogramme', retail_price: 800 },
        ],
      };

      mockPrismaService.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          products: {
            create: vi.fn().mockResolvedValue({ id: 'prod-sucre' }),
          },
          stock_movements: { create: vi.fn() },
        };
        return callback(tx);
      });

      await productsService.create(commerceId, dto);
      expect(mockPrismaService.$transaction).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('devrait mettre a jour les informations et les unites du produit', async () => {
      mockPrismaService.products.findFirst.mockResolvedValueOnce({
        id: 'prod-1',
        commerce_id: commerceId,
        name: 'Ancien',
        is_archived: false,
        stock_movements: [],
      });

      mockPrismaService.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          product_units: {
            deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
            createMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          products: {
            update: vi.fn().mockResolvedValue({
              id: 'prod-1',
              name: 'Nouveau',
            }),
          },
        };
        const res = await callback(tx);
        expect(tx.product_units.deleteMany).toHaveBeenCalledWith({ where: { product_id: 'prod-1' } });
        expect(tx.product_units.createMany).toHaveBeenCalledWith({
          data: [
            {
              product_id: 'prod-1',
              label: 'Unité',
              conversion_factor: 1,
              retail_price: 500,
              wholesale_price: undefined,
              is_base_unit: true,
            },
          ],
        });
        expect(tx.products.update).toHaveBeenCalledWith({
          where: { id: 'prod-1' },
          data: { name: 'Nouveau' },
          include: { category: true, product_units: true },
        });
        return res;
      });

      const res = await productsService.update(commerceId, 'prod-1', {
        name: 'Nouveau',
        units: [{ label: 'Unité', retail_price: 500, is_base_unit: true }],
      });
      expect(res.name).toBe('Nouveau');
    });
  });

  describe('archive and restore', () => {
    it('devrait archiver un produit existant', async () => {
      mockPrismaService.products.findFirst.mockResolvedValueOnce({
        id: 'prod-1',
        commerce_id: commerceId,
        is_archived: false,
        stock_movements: [],
      });
      mockPrismaService.products.update.mockResolvedValueOnce({
        id: 'prod-1',
        is_archived: true,
      });

      const result = await productsService.archive(commerceId, 'prod-1');

      expect(mockPrismaService.products.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { is_archived: true },
      });
      expect(result.is_archived).toBe(true);
    });

    it('devrait lever NotFoundException si archivage tente sur produit d un autre commerce', async () => {
      mockPrismaService.products.findFirst.mockResolvedValueOnce(null);

      await expect(
        productsService.archive(otherCommerceId, 'prod-other'),
      ).rejects.toThrow(NotFoundException);
    });

    it('devrait restaurer un produit archive avec succes', async () => {
      mockPrismaService.products.findFirst.mockResolvedValueOnce({
        id: 'prod-1',
        commerce_id: commerceId,
        is_archived: true,
      });
      mockPrismaService.products.update.mockResolvedValueOnce({
        id: 'prod-1',
        is_archived: false,
      });

      const result = await productsService.restore(commerceId, 'prod-1');

      expect(mockPrismaService.products.findFirst).toHaveBeenCalledWith({
        where: { id: 'prod-1', commerce_id: commerceId },
      });
      expect(mockPrismaService.products.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { is_archived: false },
      });
      expect(result.is_archived).toBe(false);
    });

    it('devrait lever NotFoundException si restauration tentee sur un produit inexistant', async () => {
      mockPrismaService.products.findFirst.mockResolvedValueOnce(null);

      await expect(
        productsService.restore(commerceId, 'prod-unknown'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
