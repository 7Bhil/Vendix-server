import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateCommerceDto } from './dto/update-commerce.dto.js';

export interface UploadedFilePayload {
  fieldname?: string;
  originalname?: string;
  encoding?: string;
  mimetype?: string;
  size?: number;
  buffer: Buffer;
}

@Injectable()
export class CommerceService {
  constructor(private readonly prisma: PrismaService) {
    if (process.env.CLOUDINARY_URL) {
      cloudinary.config();
    } else if (
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
    ) {
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
      });
    }
  }

  private formatSettings(commerce: {
    id: string;
    name: string;
    slug: string;
    whatsapp_number: string;
    whatsapp_phone?: string | null;
    logo_url?: string | null;
    primary_color?: string | null;
    secondary_color?: string | null;
    receipt_format?: string | null;
    show_views_public: boolean;
    created_at: Date;
    updated_at: Date;
  }) {
    const effectiveWhatsapp =
      commerce.whatsapp_phone ?? commerce.whatsapp_number;
    const primaryColor = commerce.primary_color ?? '#15803d';
    const secondaryColor = commerce.secondary_color ?? '#ca8a04';
    const receiptFormat = commerce.receipt_format ?? '80mm';
    const receiptWidth = receiptFormat.includes('58') ? '58' : '80';

    return {
      id: commerce.id,
      name: commerce.name,
      slug: commerce.slug,
      whatsapp: effectiveWhatsapp,
      whatsapp_phone: effectiveWhatsapp,
      whatsapp_number: effectiveWhatsapp,
      whatsappPhone: effectiveWhatsapp,
      whatsappNumber: effectiveWhatsapp,
      logo: commerce.logo_url,
      logo_url: commerce.logo_url,
      logoUrl: commerce.logo_url,
      primary_color: primaryColor,
      primaryColor,
      secondary_color: secondaryColor,
      secondaryColor,
      receipt_format: receiptFormat,
      receiptFormat,
      receiptWidth,
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

  async updateSettings(commerceId: string, dto: UpdateCommerceDto) {
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
      dto.whatsapp ??
      dto.whatsapp_phone ??
      dto.whatsappPhone ??
      dto.whatsapp_number ??
      dto.whatsappNumber;

    if (newWhatsapp !== undefined) {
      const trimmedPhone = newWhatsapp.trim();
      updateData.whatsapp_phone = trimmedPhone;
      updateData.whatsapp_number = trimmedPhone;
    }

    const newLogoUrl = dto.logo_url ?? dto.logoUrl ?? dto.logo;
    if (newLogoUrl !== undefined) {
      updateData.logo_url = newLogoUrl ? newLogoUrl.trim() : null;
    }

    const newPrimaryColor = dto.primary_color ?? dto.primaryColor;
    if (newPrimaryColor !== undefined) {
      updateData.primary_color = newPrimaryColor.trim();
    }

    const newSecondaryColor = dto.secondary_color ?? dto.secondaryColor;
    if (newSecondaryColor !== undefined) {
      updateData.secondary_color = newSecondaryColor.trim();
    }

    const rawReceiptFormat =
      dto.receipt_format ?? dto.receiptFormat ?? (dto as any).receiptWidth;
    if (rawReceiptFormat !== undefined) {
      const normalized = String(rawReceiptFormat).replace(/\s+/g, '').toLowerCase();
      updateData.receipt_format = normalized.includes('58') ? '58mm' : '80mm';
    }

    const newShowViewsPublic =
      dto.show_views_public ?? dto.showViewsPublic ?? dto.showViewsToPublic;
    if (newShowViewsPublic !== undefined) {
      updateData.show_views_public = Boolean(newShowViewsPublic);
    }

    const updated = await this.prisma.commerces.update({
      where: { id: commerceId },
      data: updateData,
    });

    return this.formatSettings(updated);
  }

  async uploadLogo(
    commerceId: string,
    file?: UploadedFilePayload,
    base64Data?: string,
  ) {
    if (!file && !base64Data) {
      throw new BadRequestException('Aucun fichier ou contenu image fourni.');
    }

    let logoUrl: string;

    const isCloudinaryConfigured = Boolean(
      process.env.CLOUDINARY_URL ||
        (process.env.CLOUDINARY_CLOUD_NAME &&
          process.env.CLOUDINARY_API_KEY &&
          process.env.CLOUDINARY_API_SECRET),
    );

    if (isCloudinaryConfigured) {
      try {
        if (file) {
          const result: UploadApiResponse = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              {
                folder: 'vendix/logos',
                public_id: `logo_${commerceId}_${Date.now()}`,
                resource_type: 'image',
              },
              (error, res) => {
                if (error || !res) {
                  reject(error || new Error('Erreur Cloudinary'));
                } else {
                  resolve(res);
                }
              },
            );
            stream.end(file.buffer);
          });
          logoUrl = result.secure_url || result.url;
        } else {
          const result = await cloudinary.uploader.upload(base64Data!, {
            folder: 'vendix/logos',
            public_id: `logo_${commerceId}_${Date.now()}`,
          });
          logoUrl = result.secure_url || result.url;
        }
      } catch (err: any) {
        throw new BadRequestException(
          `Échec du téléversement vers Cloudinary: ${err?.message || err}`,
        );
      }
    } else {
      // Fallback local ou Data URL
      if (file) {
        const uploadDir = path.resolve(process.cwd(), 'uploads/logos');
        try {
          await fs.mkdir(uploadDir, { recursive: true });
          const filename = `logo_${commerceId}_${Date.now()}${path.extname(file.originalname || '.png')}`;
          const filePath = path.join(uploadDir, filename);
          await fs.writeFile(filePath, file.buffer);
          logoUrl = `/uploads/logos/${filename}`;
        } catch {
          logoUrl = `data:${file.mimetype || 'image/jpeg'};base64,${file.buffer.toString('base64')}`;
        }
      } else {
        logoUrl = base64Data!;
      }
    }

    // Mise à jour immédiate du commerce en base de données
    await this.prisma.commerces.update({
      where: { id: commerceId },
      data: { logo_url: logoUrl },
    });

    return {
      url: logoUrl,
      secure_url: logoUrl,
      logoUrl,
      logo_url: logoUrl,
    };
  }
}
