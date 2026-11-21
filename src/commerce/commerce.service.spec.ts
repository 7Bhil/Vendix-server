import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommerceService } from './commerce.service.js';

describe('CommerceService', () => {
  let service: CommerceService;
  let prisma: {
    commerces: {
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };

  const mockCommerce = {
    id: 'commerce-123',
    name: 'Boutique Test',
    slug: 'boutique-test',
    whatsapp_number: '+22997000000',
    whatsapp_phone: '+22997000000',
    logo_url: 'https://example.com/logo.png',
    primary_color: '#15803d',
    secondary_color: '#ca8a04',
    receipt_format: '58mm',
    show_views_public: true,
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-02'),
  };

  beforeEach(() => {
    prisma = {
      commerces: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    };

    service = new CommerceService(prisma as any);
  });

  describe('getSettings', () => {
    it('doit renvoyer les paramètres de la boutique avec les alias camelCase et snake_case', async () => {
      prisma.commerces.findUnique.mockResolvedValue(mockCommerce);

      const result = await service.getSettings('commerce-123');

      expect(prisma.commerces.findUnique).toHaveBeenCalledWith({
        where: { id: 'commerce-123' },
      });
      expect(result.id).toBe('commerce-123');
      expect(result.name).toBe('Boutique Test');
      expect(result.whatsapp).toBe('+22997000000');
      expect(result.whatsappPhone).toBe('+22997000000');
      expect(result.primaryColor).toBe('#15803d');
      expect(result.secondaryColor).toBe('#ca8a04');
      expect(result.receiptFormat).toBe('58mm');
      expect(result.receiptWidth).toBe('58');
      expect(result.showViewsToPublic).toBe(true);
      expect(result.logoUrl).toBe('https://example.com/logo.png');
    });

    it('doit lever NotFoundException si la boutique est introuvable', async () => {
      prisma.commerces.findUnique.mockResolvedValue(null);

      await expect(service.getSettings('inconnue')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateSettings', () => {
    it('doit mettre à jour les réglages de la boutique', async () => {
      prisma.commerces.findUnique.mockResolvedValue(mockCommerce);
      prisma.commerces.update.mockResolvedValue({
        ...mockCommerce,
        name: 'Nouveau Nom',
        primary_color: '#2563eb',
        receipt_format: '80mm',
      });

      const result = await service.updateSettings('commerce-123', {
        name: 'Nouveau Nom',
        primaryColor: '#2563eb',
        receiptFormat: '80mm',
      });

      expect(prisma.commerces.update).toHaveBeenCalledWith({
        where: { id: 'commerce-123' },
        data: expect.objectContaining({
          name: 'Nouveau Nom',
          primary_color: '#2563eb',
          receipt_format: '80mm',
        }),
      });
      expect(result.name).toBe('Nouveau Nom');
      expect(result.primaryColor).toBe('#2563eb');
    });

    it('doit rejeter la modification si le slug est déjà utilisé par une autre boutique', async () => {
      prisma.commerces.findUnique.mockResolvedValue(mockCommerce);
      prisma.commerces.findFirst.mockResolvedValue({ id: 'autre-commerce' });

      await expect(
        service.updateSettings('commerce-123', { slug: 'autre-slug' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('uploadLogo', () => {
    it('doit mettre à jour le logo en base et renvoyer le résultat', async () => {
      prisma.commerces.update.mockResolvedValue({
        ...mockCommerce,
        logo_url: 'https://cloudinary.com/vendix/logo.png',
      });

      const result = await service.uploadLogo(
        'commerce-123',
        undefined,
        'https://cloudinary.com/vendix/logo.png',
      );

      expect(prisma.commerces.update).toHaveBeenCalledWith({
        where: { id: 'commerce-123' },
        data: { logo_url: 'https://cloudinary.com/vendix/logo.png' },
      });
      expect(result.url).toBe('https://cloudinary.com/vendix/logo.png');
      expect(result.secure_url).toBe('https://cloudinary.com/vendix/logo.png');
    });
  });
});
