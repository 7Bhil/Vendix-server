import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateCommerceSettingsDto } from './dto/commerce-settings.dto.js';

@Injectable()
export class CommerceService {
  constructor(private readonly prisma: PrismaService) {}

  private formatSettings(commerce: {
    id: string;
    name: string;
    slug: string;
    whatsapp_number: string;
    whatsapp_phone: string | null;
    logo_url: string | null;
    primary_color: string | null;
    secondary_color: string | null;
    receipt_format: string;
    show_views_public: boolean;
    created_at: Date;
    updated_at: Date;
  }) {
    const effectiveWhatsapp =
      commerce.whatsapp_phone ?? commerce.whatsapp_number;
    const primaryColor = commerce.primary_color ?? '#059669';
    const secondaryColor = commerce.secondary_color ?? '#d97706';
    const receiptFormat = commerce.receipt_format ?? '58mm';

    return {
      id: commerce.id,
      name: commerce.name,
      slug: commerce.slug,
      whatsapp_phone: effectiveWhatsapp,
      whatsapp_number: effectiveWhatsapp,
      whatsappPhone: effectiveWhatsapp,
      whatsappNumber: effectiveWhatsapp,
      logo_url: commerce.logo_url,
      logoUrl: commerce.logo_url,
      primary_color: primaryColor,
      primaryColor,
      secondary_color: secondaryColor,
      secondaryColor,
      receipt_format: receiptFormat,
      receiptFormat,
      show_views_public: commerce.show_views_public,
      showViewsPublic: commerce.show_views_public,
      showViewsToPublic: commerce.show_views_public,
      created_at: commerce.created_at,
      updated_at: commerce.updated_at,
    };
  }

  async getSettings(commerceId: string) {
    const commerce = await this.prisma.commerces.findUnique({
      where: { id: commerceId },
    });

    if (!commerce) {
      throw new NotFoundException('Boutique introuvable.');
    }

    return this.formatSettings(commerce);
  }

  async updateSettings(commerceId: string, dto: UpdateCommerceSettingsDto) {
    const existing = await this.prisma.commerces.findUnique({
      where: { id: commerceId },
    });

    if (!existing) {
      throw new NotFoundException('Boutique introuvable.');
    }

    const updateData: Prisma.commercesUncheckedUpdateInput = {};

    if (dto.name !== undefined) {
      updateData.name = dto.name.trim();
    }

    if (dto.slug !== undefined) {
      const normalizedSlug = dto.slug
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)+/g, '');

      if (normalizedSlug && normalizedSlug !== existing.slug) {
        const slugConflict = await this.prisma.commerces.findFirst({
          where: {
            slug: normalizedSlug,
            id: { not: commerceId },
          },
        });

        if (slugConflict) {
          throw new ConflictException(
            'Ce slug de boutique est déjà utilisé par un autre commerce.',
          );
        }

        updateData.slug = normalizedSlug;
      }
    }

    const newWhatsapp =
      dto.whatsapp_phone ??
      dto.whatsappPhone ??
      dto.whatsapp_number ??
      dto.whatsappNumber;

    if (newWhatsapp !== undefined) {
      const trimmedPhone = newWhatsapp.trim();
      updateData.whatsapp_phone = trimmedPhone;
      updateData.whatsapp_number = trimmedPhone;
    }

    const newLogoUrl = dto.logo_url ?? dto.logoUrl;
    if (newLogoUrl !== undefined) {
      updateData.logo_url = newLogoUrl.trim();
    }

    const newPrimaryColor = dto.primary_color ?? dto.primaryColor;
    if (newPrimaryColor !== undefined) {
      updateData.primary_color = newPrimaryColor.trim();
    }

    const newSecondaryColor = dto.secondary_color ?? dto.secondaryColor;
    if (newSecondaryColor !== undefined) {
      updateData.secondary_color = newSecondaryColor.trim();
    }

    const rawReceiptFormat = dto.receipt_format ?? dto.receiptFormat;
    if (rawReceiptFormat !== undefined) {
      updateData.receipt_format = rawReceiptFormat.replace(/\s+/g, '').toLowerCase();
    }

    const newShowViewsPublic =
      dto.show_views_public ?? dto.showViewsPublic ?? dto.showViewsToPublic;
    if (newShowViewsPublic !== undefined) {
      updateData.show_views_public = newShowViewsPublic;
    }

    const updated = await this.prisma.commerces.update({
      where: { id: commerceId },
      data: updateData,
    });

    return this.formatSettings(updated);
  }
}

