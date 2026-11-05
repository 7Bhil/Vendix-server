import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { CategoriesService } from './categories.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('CategoriesService', () => {
  let categoriesService: CategoriesService;

  const mockPrismaService = {
    categories: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    products: {
      count: vi.fn(),
      updateMany: vi.fn(),
    },
  };

  const commerceId = 'commerce-uuid-1';
  const otherCommerceId = 'commerce-uuid-2';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    categoriesService = module.get<CategoriesService>(CategoriesService);
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(categoriesService).toBeDefined();
  });

  describe('findAll', () => {
    it('devrait retourner les categories filtrees par commerce_id', async () => {
      const mockCategories = [
        { id: 'cat-1', commerce_id: commerceId, name: 'Alimentation', _count: { products: 5 } },
      ];
      mockPrismaService.categories.findMany.mockResolvedValueOnce(mockCategories);

      const result = await categoriesService.findAll(commerceId);

      expect(mockPrismaService.categories.findMany).toHaveBeenCalledWith({
        where: { commerce_id: commerceId },
        include: {
          _count: {
            select: { products: true },
          },
        },
        orderBy: { name: 'asc' },
      });
      expect(result).toEqual(mockCategories);
    });
  });

  describe('findOne (Tenant Isolation - BOLA)', () => {
    it('devrait retourner la categorie si elle appartient au commerce', async () => {
      const mockCategory = {
        id: 'cat-1',
        commerce_id: commerceId,
        name: 'Boissons',
        products: [],
      };
      mockPrismaService.categories.findFirst.mockResolvedValueOnce(mockCategory);

      const result = await categoriesService.findOne(commerceId, 'cat-1');

      expect(mockPrismaService.categories.findFirst).toHaveBeenCalledWith({
        where: { id: 'cat-1', commerce_id: commerceId },
        include: {
          products: {
            where: { is_archived: false },
            include: { product_units: true },
          },
        },
      });
      expect(result).toEqual(mockCategory);
    });

    it('devrait lever NotFoundException si la categorie appartient a un autre commerce (BOLA)', async () => {
      mockPrismaService.categories.findFirst.mockResolvedValueOnce(null);

      await expect(
        categoriesService.findOne(otherCommerceId, 'cat-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('create (Unicite du nom par commerce)', () => {
    it('devrait creer avec succes une categorie unique', async () => {
      mockPrismaService.categories.findFirst.mockResolvedValueOnce(null);
      mockPrismaService.categories.create.mockResolvedValueOnce({
        id: 'cat-created',
        commerce_id: commerceId,
        name: 'Électronique',
      });

      const result = await categoriesService.create(commerceId, { name: '  Électronique  ' });

      expect(mockPrismaService.categories.findFirst).toHaveBeenCalledWith({
        where: {
          commerce_id: commerceId,
          name: {
            equals: 'Électronique',
            mode: 'insensitive',
          },
        },
      });
      expect(mockPrismaService.categories.create).toHaveBeenCalledWith({
        data: {
          commerce_id: commerceId,
          name: 'Électronique',
        },
      });
      expect(result.name).toBe('Électronique');
    });

    it('devrait rejeter par ConflictException si une categorie de meme nom existe pour ce commerce', async () => {
      mockPrismaService.categories.findFirst.mockResolvedValueOnce({
        id: 'existing-cat',
        commerce_id: commerceId,
        name: 'Électronique',
      });

      await expect(
        categoriesService.create(commerceId, { name: 'électronique' }),
      ).rejects.toThrow(ConflictException);

      expect(mockPrismaService.categories.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('devrait refuser la mise a jour si le nouveau nom est en conflit avec une autre categorie', async () => {
      mockPrismaService.categories.findFirst
        .mockResolvedValueOnce({ id: 'cat-1', commerce_id: commerceId, name: 'Old' })
        .mockResolvedValueOnce({ id: 'cat-2', commerce_id: commerceId, name: 'Conflit' });

      await expect(
        categoriesService.update(commerceId, 'cat-1', { name: 'Conflit' }),
      ).rejects.toThrow(ConflictException);

      expect(mockPrismaService.categories.update).not.toHaveBeenCalled();
    });

    it('devrait autoriser le renommage sans conflit', async () => {
      mockPrismaService.categories.findFirst
        .mockResolvedValueOnce({ id: 'cat-1', commerce_id: commerceId, name: 'Old' })
        .mockResolvedValueOnce(null);
      mockPrismaService.categories.update.mockResolvedValueOnce({
        id: 'cat-1',
        commerce_id: commerceId,
        name: 'New Name',
      });

      const result = await categoriesService.update(commerceId, 'cat-1', { name: 'New Name' });

      expect(result.name).toBe('New Name');
      expect(mockPrismaService.categories.update).toHaveBeenCalledWith({
        where: { id: 'cat-1' },
        data: { name: 'New Name' },
      });
    });
  });

  describe('remove (Suppression et reaffectation des produits)', () => {
    it('devrait supprimer directement la categorie si elle n a aucun produit rattache', async () => {
      mockPrismaService.categories.findFirst.mockResolvedValueOnce({
        id: 'cat-empty',
        commerce_id: commerceId,
        name: 'Vide',
      });
      mockPrismaService.products.count.mockResolvedValueOnce(0);
      mockPrismaService.categories.delete.mockResolvedValueOnce({ id: 'cat-empty' });

      const result = await categoriesService.remove(commerceId, 'cat-empty');

      expect(mockPrismaService.categories.delete).toHaveBeenCalledWith({
        where: { id: 'cat-empty' },
      });
      expect(result).toEqual({ id: 'cat-empty' });
    });

    it('devrait refuser la suppression si des produits y sont rattaches sans categorie de reaffectation', async () => {
      mockPrismaService.categories.findFirst.mockResolvedValueOnce({
        id: 'cat-busy',
        commerce_id: commerceId,
        name: 'Occupee',
      });
      mockPrismaService.products.count.mockResolvedValueOnce(3);

      await expect(
        categoriesService.remove(commerceId, 'cat-busy'),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrismaService.categories.delete).not.toHaveBeenCalled();
    });

    it('devrait reaffecter les produits puis supprimer la categorie si reassignCategoryId est fourni', async () => {
      mockPrismaService.categories.findFirst
        .mockResolvedValueOnce({ id: 'cat-busy', commerce_id: commerceId, name: 'Occupee' })
        .mockResolvedValueOnce({ id: 'cat-target', commerce_id: commerceId, name: 'Cible' });
      mockPrismaService.products.count.mockResolvedValueOnce(4);
      mockPrismaService.products.updateMany.mockResolvedValueOnce({ count: 4 });
      mockPrismaService.categories.delete.mockResolvedValueOnce({ id: 'cat-busy' });

      const result = await categoriesService.remove(commerceId, 'cat-busy', 'cat-target');

      expect(mockPrismaService.products.updateMany).toHaveBeenCalledWith({
        where: { commerce_id: commerceId, category_id: 'cat-busy' },
        data: { category_id: 'cat-target' },
      });
      expect(mockPrismaService.categories.delete).toHaveBeenCalledWith({
        where: { id: 'cat-busy' },
      });
      expect(result).toEqual({ id: 'cat-busy' });
    });
  });
});
