import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TrackVisitDto } from './dto/track-visit.dto.js';
import { GetShopProductsDto } from './dto/get-shop-products.dto.js';

@Injectable()
export class PublicShopService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Récupère les informations publiques d'une boutique à partir de son slug.
   */
  async getShopBySlug(slug: string) {
    const normalizedSlug = slug.trim().toLowerCase();

    const commerce = await this.prisma.commerces.findUnique({
      where: { slug: normalizedSlug },
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

    if (!commerce) {
      throw new NotFoundException('Boutique introuvable.');
    }

    return {
      ...commerce,
      // Alias camelCase pour compatibilite directe avec le front Vendix
      whatsapp: commerce.whatsapp_number,
      logoUrl: commerce.logo_url,
      primaryColor: commerce.primary_color,
      secondaryColor: commerce.secondary_color,
      showViewsToPublic: commerce.show_views_public,
    };
  }

  /**
   * Liste les produits publics (is_visible_public: true et is_archived: false) d'une boutique.
   * Aucun coût d'achat fournisseur (default_cost_price / costPrice) ni marge n'est exposé.
   */
  async getShopProducts(
    slug: string,
    query?: GetShopProductsDto,
  ) {
    const normalizedSlug = slug.trim().toLowerCase();

    const commerce = await this.prisma.commerces.findUnique({
      where: { slug: normalizedSlug },
      select: {
        id: true,
        show_views_public: true,
      },
    });

    if (!commerce) {
      throw new NotFoundException('Boutique introuvable.');
    }

    const where: Prisma.productsWhereInput = {
      commerce_id: commerce.id,
      is_visible_public: true,
      is_archived: false,
    };

    if (query?.categoryId) {
      where.category_id = query.categoryId;
    }

    if (query?.search?.trim()) {
      where.name = {
        contains: query.search.trim(),
        mode: 'insensitive',
      };
    }

    const take = Math.min(Math.max(Number(query?.limit ?? 50), 1), 100);
    const skip = Math.max(Number(query?.offset ?? 0), 0);

    const products = await this.prisma.products.findMany({
      where,
      take,
      skip,
      select: {
        id: true,
        name: true,
        image_url: true,
        category_id: true,
        is_visible_public: true,
        views_count: true,
        created_at: true,
        updated_at: true,
        category: {
          select: {
            id: true,
            name: true,
          },
        },
        product_units: {
          select: {
            id: true,
            label: true,
            conversion_factor: true,
            retail_price: true,
            wholesale_price: true,
            is_base_unit: true,
          },
          orderBy: { conversion_factor: 'asc' },
        },
        stock_movements: {
          select: {
            quantity_delta: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    return products.map((product) => {
      const rawStock = product.stock_movements.reduce(
        (acc, sm) => acc + Number(sm.quantity_delta),
        0,
      );
      const currentStock = Math.max(0, rawStock);
      const baseUnit =
        product.product_units.find((u) => u.is_base_unit) ??
        product.product_units[0];

      return {
        id: product.id,
        name: product.name,
        image_url: product.image_url,
        category_id: product.category_id,
        category: product.category,
        is_visible_public: product.is_visible_public,
        base_price: baseUnit ? baseUnit.retail_price : 0,
        product_units: product.product_units.map((u) => ({
          id: u.id,
          label: u.label,
          conversion_factor: Number(u.conversion_factor),
          retail_price: u.retail_price,
          wholesale_price: u.wholesale_price,
          is_base_unit: u.is_base_unit,
        })),
        current_stock: currentStock,
        in_stock: rawStock > 0,
        ...(commerce.show_views_public
          ? { views_count: product.views_count }
          : {}),
      };
    });
  }

  /**
   * Récupère la fiche détaillée d'un article public appartenant à une boutique.
   * Filtre strictement les articles non visibles ou archivés et masque tout coût fournisseur.
   */
  async getShopProductById(slug: string, productId: string) {
    const normalizedSlug = slug.trim().toLowerCase();

    const commerce = await this.prisma.commerces.findUnique({
      where: { slug: normalizedSlug },
      select: {
        id: true,
        name: true,
        slug: true,
        whatsapp_number: true,
        primary_color: true,
        secondary_color: true,
        show_views_public: true,
      },
    });

    if (!commerce) {
      throw new NotFoundException('Boutique introuvable.');
    }

    const product = await this.prisma.products.findFirst({
      where: {
        id: productId,
        commerce_id: commerce.id,
        is_visible_public: true,
        is_archived: false,
      },
      select: {
        id: true,
        name: true,
        image_url: true,
        category_id: true,
        is_visible_public: true,
        views_count: true,
        created_at: true,
        updated_at: true,
        category: {
          select: {
            id: true,
            name: true,
          },
        },
        product_units: {
          select: {
            id: true,
            label: true,
            conversion_factor: true,
            retail_price: true,
            wholesale_price: true,
            is_base_unit: true,
          },
          orderBy: { conversion_factor: 'asc' },
        },
        stock_movements: {
          select: {
            quantity_delta: true,
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Produit introuvable.');
    }

    const rawStock = product.stock_movements.reduce(
      (acc, sm) => acc + Number(sm.quantity_delta),
      0,
    );
    const currentStock = Math.max(0, rawStock);
    const baseUnit =
      product.product_units.find((u) => u.is_base_unit) ??
      product.product_units[0];
    const basePrice = baseUnit ? baseUnit.retail_price : 0;

    const cleanPhone = commerce.whatsapp_number.replace(/[^0-9]/g, '');
    const orderMessage = `Bonjour ${commerce.name}, je suis intéressé(e) par l'article "${product.name}" (${basePrice} FCFA) vu sur votre boutique en ligne.`;
    const whatsappOrderUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(orderMessage)}`;
    const baseUnitLabel = baseUnit ? baseUnit.label : 'Unité';

    return {
      id: product.id,
      name: product.name,
      image_url: product.image_url,
      photoUrl: product.image_url,
      category_id: product.category_id,
      category: product.category,
      categoryName: product.category?.name || '',
      is_visible_public: product.is_visible_public,
      base_price: basePrice,
      publicPrice: basePrice,
      baseUnit: baseUnitLabel,
      product_units: product.product_units.map((u) => ({
        id: u.id,
        label: u.label,
        conversion_factor: Number(u.conversion_factor),
        retail_price: u.retail_price,
        wholesale_price: u.wholesale_price,
        is_base_unit: u.is_base_unit,
      })),
      current_stock: currentStock,
      in_stock: rawStock > 0,
      available: rawStock > 0,
      ...(commerce.show_views_public
        ? {
            views_count: product.views_count,
            viewsCount: product.views_count,
          }
        : {}),
      whatsapp_order_url: whatsappOrderUrl,
      whatsappOrderUrl: whatsappOrderUrl,
      shop: {
        id: commerce.id,
        name: commerce.name,
        slug: commerce.slug,
        whatsapp_number: commerce.whatsapp_number,
        whatsapp: commerce.whatsapp_number,
        primary_color: commerce.primary_color,
        primaryColor: commerce.primary_color,
        secondary_color: commerce.secondary_color,
        secondaryColor: commerce.secondary_color,
      },
    };
  }

  /**
   * Incrémentation anonymisée et minimisée du compteur de visite/vue (conforme RGPD, sans cookies tiers).
   * Aucune adresse IP, aucun User-Agent et aucun identifiant personnel du visiteur n'est stocké.
   */
  async trackVisit(slug: string, dto?: TrackVisitDto) {
    const normalizedSlug = slug.trim().toLowerCase();

    const commerce = await this.prisma.commerces.findUnique({
      where: { slug: normalizedSlug },
      select: {
        id: true,
        user_id: true,
        slug: true,
        show_views_public: true,
      },
    });

    if (!commerce) {
      throw new NotFoundException('Boutique introuvable.');
    }

    const targetProductId = dto?.product_id ?? dto?.productId;

    if (targetProductId) {
      const product = await this.prisma.products.findFirst({
        where: {
          id: targetProductId,
          commerce_id: commerce.id,
          is_visible_public: true,
          is_archived: false,
        },
        select: { id: true },
      });

      if (!product) {
        throw new NotFoundException('Produit introuvable.');
      }

      const updatedProduct = await this.prisma.products.update({
        where: { id: product.id },
        data: {
          views_count: { increment: 1 },
        },
        select: {
          id: true,
          views_count: true,
        },
      });

      await this.prisma.audit_logs.create({
        data: {
          user_id: commerce.user_id,
          event_type: 'PUBLIC_PRODUCT_VIEW',
          details: {
            commerce_id: commerce.id,
            slug: commerce.slug,
            product_id: product.id,
          },
        },
      });

      return {
        tracked: true,
        scope: 'PRODUCT',
        product_id: updatedProduct.id,
        ...(commerce.show_views_public
          ? { views_count: updatedProduct.views_count }
          : {}),
      };
    }

    await this.prisma.audit_logs.create({
      data: {
        user_id: commerce.user_id,
        event_type: 'PUBLIC_SHOP_VISIT',
        details: {
          commerce_id: commerce.id,
          slug: commerce.slug,
        },
      },
    });

    return {
      tracked: true,
      scope: 'SHOP',
      slug: commerce.slug,
    };
  }
}
