import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PublicShopService } from './public-shop.service.js';
import { PublicShopController } from './public-shop.controller.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { TenantGuard } from '../auth/guards/tenant.guard.js';

describe('PublicShopService & PublicShopController', () => {
  let publicShopService: PublicShopService;
  let publicShopController: PublicShopController;

  const mockPrismaService = {
    commerces: {
      findUnique: vi.fn(),
    },
    products: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    audit_logs: {
      create: vi.fn(),
    },
  };

  const shopSlug = 'maman-adjoua-boutique';
  const commerceId = 'commerce-uuid-1';
  const ownerUserId = 'user-uuid-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PublicShopController],
      providers: [
        PublicShopService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    publicShopService = module.get<PublicShopService>(PublicShopService);
    publicShopController = module.get<PublicShopController>(PublicShopController);
    vi.clearAllMocks();
  });

  describe('Accès public sans jeton JWT (@Public)', () => {
    it('devrait autoriser l acces aux routes de PublicShopController sans en-tete Authorization', () => {
      const reflector = new Reflector();
      const jwtGuard = new JwtAuthGuard(reflector);
      const tenantGuard = new TenantGuard(reflector);

      const mockContext = {
        getHandler: () => publicShopController.getShopBySlug,
        getClass: () => PublicShopController,
        switchToHttp: () => ({
          getRequest: () => ({ headers: {} }),
        }),
      } as unknown as ExecutionContext;

      expect(jwtGuard.canActivate(mockContext)).toBe(true);
      expect(tenantGuard.canActivate(mockContext)).toBe(true);
    });
  });

  describe('getShopBySlug (GET /api/v1/public/shop/:slug)', () => {
    it('devrait retourner les details publics de la boutique (nom, logo, WhatsApp, couleurs, categories)', async () => {
      const mockShop = {
        id: commerceId,
        name: 'Boutique Maman Adjoua',
        slug: shopSlug,
        whatsapp_number: '+2290197000000',
        logo_url: 'https://cdn.vendix.bj/logos/adjoua.png',
        primary_color: '#1e40af',
        secondary_color: '#f59e0b',
        show_views_public: true,
        categories: [
          { id: 'cat-1', name: 'Alimentation' },
          { id: 'cat-2', name: 'Boissons' },
        ],
      };

      mockPrismaService.commerces.findUnique.mockResolvedValueOnce(mockShop);

      const result = await publicShopService.getShopBySlug('  Maman-Adjoua-Boutique ');

      expect(mockPrismaService.commerces.findUnique).toHaveBeenCalledWith({
        where: { slug: shopSlug },
        select: {
          id: true,
          name: true,
          slug: true,
          whatsapp_number: true,
          logo_url: true,
          primary_color: true,
          secondary_color: true,
          show_views_public: true,
          categories: {
            select: {
              id: true,
              name: true,
            },
            orderBy: { name: 'asc' },
          },
        },
      });
      expect(result).toMatchObject(mockShop);
      expect(result.whatsapp).toBe(mockShop.whatsapp_number);
      expect(result.logoUrl).toBe(mockShop.logo_url);
      expect(result.primaryColor).toBe(mockShop.primary_color);
      expect(result.secondaryColor).toBe(mockShop.secondary_color);
      expect(result.showViewsToPublic).toBe(mockShop.show_views_public);
      expect(result).not.toHaveProperty('user_id');
    });

    it('devrait lever NotFoundException si le slug de la boutique n existe pas', async () => {
      mockPrismaService.commerces.findUnique.mockResolvedValueOnce(null);

      await expect(
        publicShopService.getShopBySlug('boutique-inexistante'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getShopProducts (GET /api/v1/public/shop/:slug/products)', () => {
    it('devrait lister uniquement les produits visibles et non archives sans exposer default_cost_price ni marge', async () => {
      mockPrismaService.commerces.findUnique.mockResolvedValueOnce({
        id: commerceId,
        show_views_public: false,
      });

      const mockDbProducts = [
        {
          id: 'prod-1',
          name: 'Riz Parfumé 25kg',
          image_url: 'https://cdn.vendix.bj/products/riz.jpg',
          category_id: 'cat-1',
          is_visible_public: true,
          views_count: 42,
          created_at: new Date('2026-11-01T10:00:00Z'),
          updated_at: new Date('2026-11-01T10:00:00Z'),
          category: { id: 'cat-1', name: 'Alimentation' },
          product_units: [
            {
              id: 'u-1',
              label: 'Kg',
              conversion_factor: 1,
              retail_price: 600,
              wholesale_price: null,
              is_base_unit: true,
            },
            {
              id: 'u-2',
              label: 'Sac 25kg',
              conversion_factor: 25,
              retail_price: 14000,
              wholesale_price: 13500,
              is_base_unit: false,
            },
          ],
          stock_movements: [{ quantity_delta: 50 }, { quantity_delta: -10 }],
        },
      ];

      mockPrismaService.products.findMany.mockResolvedValueOnce(mockDbProducts);

      const result = await publicShopService.getShopProducts(shopSlug, {
        categoryId: 'cat-1',
        search: 'riz',
      });

      expect(mockPrismaService.products.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            commerce_id: commerceId,
            is_visible_public: true,
            is_archived: false,
            category_id: 'cat-1',
            name: {
              contains: 'riz',
              mode: 'insensitive',
            },
          },
        }),
      );

      // Vérifie que default_cost_price n'est même pas sélectionné dans la requête Prisma
      const prismaCallArgs = mockPrismaService.products.findMany.mock.calls[0]?.[0];
      expect(prismaCallArgs?.select?.default_cost_price).toBeUndefined();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'prod-1',
        name: 'Riz Parfumé 25kg',
        image_url: 'https://cdn.vendix.bj/products/riz.jpg',
        category_id: 'cat-1',
        category: { id: 'cat-1', name: 'Alimentation' },
        is_visible_public: true,
        base_price: 600,
        product_units: [
          {
            id: 'u-1',
            label: 'Kg',
            conversion_factor: 1,
            retail_price: 600,
            is_base_unit: true,
          },
          {
            id: 'u-2',
            label: 'Sac 25kg',
            conversion_factor: 25,
            retail_price: 14000,
            is_base_unit: false,
          },
        ],
        current_stock: 40,
        in_stock: true,
      });

      expect(result[0]).not.toHaveProperty('default_cost_price');
      expect(result[0]).not.toHaveProperty('costPrice');
      expect(result[0]).not.toHaveProperty('margin');
      expect(result[0]).not.toHaveProperty('views_count');
    });

    it('devrait inclure views_count si show_views_public est active sur la boutique', async () => {
      mockPrismaService.commerces.findUnique.mockResolvedValueOnce({
        id: commerceId,
        show_views_public: true,
      });

      mockPrismaService.products.findMany.mockResolvedValueOnce([
        {
          id: 'prod-1',
          name: 'Huile 1L',
          image_url: null,
          category_id: null,
          is_visible_public: true,
          views_count: 18,
          created_at: new Date(),
          updated_at: new Date(),
          category: null,
          product_units: [
            {
              id: 'u-1',
              label: 'Bouteille',
              conversion_factor: 1,
              retail_price: 1200,
              wholesale_price: null,
              is_base_unit: true,
            },
          ],
          stock_movements: [],
        },
      ]);

      const result = await publicShopService.getShopProducts(shopSlug);
      expect(result[0]?.views_count).toBe(18);
      expect(result[0]?.in_stock).toBe(false);
      expect(result[0]?.current_stock).toBe(0);
    });
  });

  describe('getShopProductById (GET /api/v1/public/shop/:slug/products/:id)', () => {
    it('devrait retourner la fiche detaillee publique avec lien de commande WhatsApp et sans cout d achat', async () => {
      mockPrismaService.commerces.findUnique.mockResolvedValueOnce({
        id: commerceId,
        name: 'Boutique Maman Adjoua',
        slug: shopSlug,
        whatsapp_number: '+229 01 97 00 00 00',
        primary_color: '#1e40af',
        secondary_color: '#f59e0b',
        show_views_public: true,
      });

      mockPrismaService.products.findFirst.mockResolvedValueOnce({
        id: 'prod-1',
        name: 'Savon Palmida',
        image_url: null,
        category_id: 'cat-1',
        is_visible_public: true,
        views_count: 12,
        created_at: new Date(),
        updated_at: new Date(),
        category: { id: 'cat-1', name: 'Hygiène' },
        product_units: [
          {
            id: 'u-1',
            label: 'Pain',
            conversion_factor: 1,
            retail_price: 350,
            wholesale_price: 300,
            is_base_unit: true,
          },
        ],
        stock_movements: [{ quantity_delta: 25 }],
      });

      const result = await publicShopService.getShopProductById(shopSlug, 'prod-1');

      expect(mockPrismaService.products.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'prod-1',
            commerce_id: commerceId,
            is_visible_public: true,
            is_archived: false,
          },
        }),
      );

      expect(result.name).toBe('Savon Palmida');
      expect(result.base_price).toBe(350);
      expect(result.in_stock).toBe(true);
      expect(result.current_stock).toBe(25);
      expect(result.views_count).toBe(12);
      expect(result.whatsapp_order_url).toContain('https://wa.me/2290197000000?text=');
      expect(result).not.toHaveProperty('default_cost_price');
      expect(result).not.toHaveProperty('costPrice');
    });

    it('devrait lever NotFoundException si le produit est masque (is_visible_public: false) ou archive', async () => {
      mockPrismaService.commerces.findUnique.mockResolvedValueOnce({
        id: commerceId,
        name: 'Boutique Maman Adjoua',
        slug: shopSlug,
        whatsapp_number: '+2290197000000',
        primary_color: '#1e40af',
        secondary_color: '#f59e0b',
        show_views_public: false,
      });

      mockPrismaService.products.findFirst.mockResolvedValueOnce(null);

      await expect(
        publicShopService.getShopProductById(shopSlug, 'prod-hidden-or-archived'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('trackVisit (POST /api/v1/public/shop/:slug/track-visit)', () => {
    it('devrait enregistrer une visite de boutique anonymisee sans donnees personnelles', async () => {
      mockPrismaService.commerces.findUnique.mockResolvedValueOnce({
        id: commerceId,
        user_id: ownerUserId,
        slug: shopSlug,
        show_views_public: false,
      });
      mockPrismaService.audit_logs.create.mockResolvedValueOnce({ id: 'log-1' });

      const result = await publicShopService.trackVisit(shopSlug, {});

      expect(mockPrismaService.audit_logs.create).toHaveBeenCalledWith({
        data: {
          user_id: ownerUserId,
          event_type: 'PUBLIC_SHOP_VISIT',
          details: {
            commerce_id: commerceId,
            slug: shopSlug,
          },
        },
      });
      expect(result).toEqual({
        tracked: true,
        scope: 'SHOP',
        slug: shopSlug,
      });
    });

    it('devrait incrementer le compteur de vues d un produit public lors d une visite produit', async () => {
      mockPrismaService.commerces.findUnique.mockResolvedValueOnce({
        id: commerceId,
        user_id: ownerUserId,
        slug: shopSlug,
        show_views_public: true,
      });
      mockPrismaService.products.findFirst.mockResolvedValueOnce({
        id: 'prod-1',
      });
      mockPrismaService.products.update.mockResolvedValueOnce({
        id: 'prod-1',
        views_count: 15,
      });
      mockPrismaService.audit_logs.create.mockResolvedValueOnce({ id: 'log-2' });

      const result = await publicShopService.trackVisit(shopSlug, {
        product_id: 'prod-1',
      });

      expect(mockPrismaService.products.update).toHaveBeenCalledWith({
        where: { id: 'prod-1' },
        data: { views_count: { increment: 1 } },
        select: { id: true, views_count: true },
      });
      expect(result).toEqual({
        tracked: true,
        scope: 'PRODUCT',
        product_id: 'prod-1',
        views_count: 15,
      });
    });

    it('devrait refuser d incrementer les vues d un produit non visible ou archive', async () => {
      mockPrismaService.commerces.findUnique.mockResolvedValueOnce({
        id: commerceId,
        user_id: ownerUserId,
        slug: shopSlug,
        show_views_public: true,
      });
      mockPrismaService.products.findFirst.mockResolvedValueOnce(null);

      await expect(
        publicShopService.trackVisit(shopSlug, { product_id: 'prod-hidden' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
