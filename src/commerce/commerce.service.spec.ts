import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { CommerceService } from './commerce.service.js';
import { CommerceController } from './commerce.controller.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('CommerceService & CommerceController (Settings)', () => {
  let commerceService: CommerceService;
  let commerceController: CommerceController;

  const mockPrismaService = {
    commerces: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  };

  const commerceId = 'commerce-uuid-1';
  const now = new Date('2026-11-10T10:00:00Z');

  const baseCommerce = {
    id: commerceId,
    user_id: 'user-uuid-1',
    name: 'Boutique Maman Adjoua',
    slug: 'maman-adjoua',
    whatsapp_number: '+2290197000000',
    whatsapp_phone: '+2290197000000',
    logo_url: 'https://cdn.vendix.bj/logos/adjoua.png',
    primary_color: '#059669',
    secondary_color: '#d97706',
    receipt_format: '58mm',
    show_views_public: true,
    created_at: now,
    updated_at: now,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommerceController],
      providers: [
        CommerceService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    commerceService = module.get<CommerceService>(CommerceService);
    commerceController = module.get<CommerceController>(CommerceController);
    vi.clearAllMocks();
  });

  describe('getSettings (GET /api/v1/commerce/settings)', () => {
    it('devrait retourner les parametres de la boutique du commercant connecte', async () => {
      mockPrismaService.commerces.findUnique.mockResolvedValueOnce(baseCommerce);

      const result = await commerceController.getSettings(commerceId);

      expect(mockPrismaService.commerces.findUnique).toHaveBeenCalledWith({
        where: { id: commerceId },
      });
      expect(result.id).toBe(commerceId);
      expect(result.whatsapp_phone).toBe('+2290197000000');
      expect(result.primary_color).toBe('#059669');
      expect(result.secondary_color).toBe('#d97706');
      expect(result.receipt_format).toBe('58mm');
      expect(result.show_views_public).toBe(true);
    });

    it('devrait lever NotFoundException si la boutique est introuvable', async () => {
      mockPrismaService.commerces.findUnique.mockResolvedValueOnce(null);

      await expect(
        commerceService.getSettings('commerce-inexistant'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateSettings (PATCH /api/v1/commerce/settings)', () => {
    it('devrait modifier le format de ticket (80mm), les couleurs et WhatsApp uniquement pour ce commerce', async () => {
      mockPrismaService.commerces.findUnique.mockResolvedValueOnce(baseCommerce);
      mockPrismaService.commerces.update.mockResolvedValueOnce({
        ...baseCommerce,
        whatsapp_phone: '+2290196998877',
        whatsapp_number: '+2290196998877',
        primary_color: '#1e40af',
        secondary_color: '#f59e0b',
        receipt_format: '80mm',
        show_views_public: false,
      });

      const result = await commerceController.updateSettings(commerceId, {
        whatsapp_phone: '+2290196998877',
        primary_color: '#1e40af',
        secondary_color: '#f59e0b',
        receipt_format: '80 mm',
        show_views_public: false,
      });

      expect(mockPrismaService.commerces.update).toHaveBeenCalledWith({
        where: { id: commerceId },
        data: {
          whatsapp_phone: '+2290196998877',
          whatsapp_number: '+2290196998877',
          primary_color: '#1e40af',
          secondary_color: '#f59e0b',
          receipt_format: '80mm',
          show_views_public: false,
        },
      });

      expect(result.receipt_format).toBe('80mm');
      expect(result.receiptFormat).toBe('80mm');
      expect(result.primary_color).toBe('#1e40af');
      expect(result.show_views_public).toBe(false);
    });

    it('devrait lever ConflictException si le nouveau slug est deja utilise par une autre boutique', async () => {
      mockPrismaService.commerces.findUnique.mockResolvedValueOnce(baseCommerce);
      mockPrismaService.commerces.findFirst.mockResolvedValueOnce({
        id: 'other-commerce-id',
        slug: 'slug-deja-pris',
      });

      await expect(
        commerceService.updateSettings(commerceId, {
          slug: 'slug-deja-pris',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });
});

