import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto.js';
import { Prisma, StockMovementType } from '@prisma/client';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(commerceId: string, query?: { categoryId?: string; search?: string; publicOnly?: boolean }) {
    const where: Prisma.productsWhereInput = {
      commerce_id: commerceId,
      is_archived: false,
    };

    if (query?.categoryId) {
      where.category_id = query.categoryId;
    }

    if (query?.publicOnly) {
      where.is_visible_public = true;
    }

    if (query?.search?.trim()) {
      where.name = {
        contains: query.search.trim(),
        mode: 'insensitive',
      };
    }

    return this.prisma.products.findMany({
      where,
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
    }).then((products) =>
      products.map((p) => {
        const currentStock = p.stock_movements.reduce(
          (acc, sm) => acc + Number(sm.quantity_delta),
          0,
        );
        const { stock_movements: _, ...rest } = p;
        return {
          ...rest,
          current_stock: currentStock,
        };
      }),
    );
  }

  async findOne(commerceId: string, id: string) {
    const product = await this.prisma.products.findFirst({
      where: { id, commerce_id: commerceId, is_archived: false },
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

    if (!product) {
      throw new NotFoundException('Produit introuvable.');
    }

    const currentStock = product.stock_movements.reduce(
      (acc, sm) => acc + Number(sm.quantity_delta),
      0,
    );

    return {
      ...product,
      current_stock: currentStock,
    };
  }

  async create(commerceId: string, dto: CreateProductDto) {
    if (!dto.units || dto.units.length === 0) {
      throw new BadRequestException('Au moins une unité de vente doit être définie.');
    }

    // Vérification d'étanchéité multi-tenant de la catégorie (Anti-BOLA/IDOR)
    if (dto.category_id) {
      const category = await this.prisma.categories.findFirst({
        where: { id: dto.category_id, commerce_id: commerceId },
      });
      if (!category) {
        throw new NotFoundException('Catégorie introuvable dans votre boutique.');
      }
    }

    const hasBase = dto.units.some((u) => u.is_base_unit);
    const unitsToInsert = dto.units.map((u, idx) => ({
      label: u.label,
      conversion_factor: u.conversion_factor || 1,
      retail_price: u.retail_price,
      wholesale_price: u.wholesale_price,
      is_base_unit: hasBase ? !!u.is_base_unit : idx === 0,
    }));

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.products.create({
        data: {
          commerce_id: commerceId,
          category_id: dto.category_id,
          name: dto.name.trim(),
          image_url: dto.image_url,
          default_cost_price: dto.default_cost_price || 0,
          is_visible_public: dto.is_visible_public ?? true,
          product_units: {
            create: unitsToInsert.map((u) => ({
              label: u.label.trim(),
              conversion_factor: u.conversion_factor,
              retail_price: u.retail_price,
              wholesale_price: u.wholesale_price,
              is_base_unit: u.is_base_unit,
            })),
          },
        },
        include: {
          product_units: true,
        },
      });

      // Si un stock initial est spécifié, enregistrer le mouvement de stock d'entrée
      if (dto.initial_stock && dto.initial_stock > 0) {
        await tx.stock_movements.create({
          data: {
            commerce_id: commerceId,
            product_id: product.id,
            type: StockMovementType.PURCHASE_ENTRY,
            quantity_delta: dto.initial_stock,
            reason: 'Stock initial à la création du produit',
          },
        });
      }

      return product;
    });
  }

  async update(commerceId: string, id: string, dto: UpdateProductDto) {
    await this.findOne(commerceId, id);

    return this.prisma.$transaction(async (tx) => {
      if (dto.units && dto.units.length > 0) {
        await tx.product_units.deleteMany({
          where: { product_id: id },
        });

        await tx.product_units.createMany({
          data: dto.units.map((u, idx) => ({
            product_id: id,
            label: u.label.trim(),
            conversion_factor: u.conversion_factor || 1,
            retail_price: u.retail_price,
            wholesale_price: u.wholesale_price,
            is_base_unit: u.is_base_unit ?? idx === 0,
          })),
        });
      }

      const updateData: Prisma.productsUncheckedUpdateInput = {};
      if (dto.name !== undefined) updateData.name = dto.name.trim();
      if (dto.category_id !== undefined) updateData.category_id = dto.category_id;
      if (dto.image_url !== undefined) updateData.image_url = dto.image_url;
      if (dto.default_cost_price !== undefined) updateData.default_cost_price = dto.default_cost_price;
      if (dto.is_visible_public !== undefined) updateData.is_visible_public = dto.is_visible_public;

      return tx.products.update({
        where: { id },
        data: updateData,
        include: {
          category: true,
          product_units: true,
        },
      });
    });
  }

  async archive(commerceId: string, id: string) {
    await this.findOne(commerceId, id);

    return this.prisma.products.update({
      where: { id },
      data: { is_archived: true },
    });
  }

  async restore(commerceId: string, id: string) {
    const product = await this.prisma.products.findFirst({
      where: { id, commerce_id: commerceId },
    });

    if (!product) {
      throw new NotFoundException('Produit introuvable.');
    }

    return this.prisma.products.update({
      where: { id },
      data: { is_archived: false },
    });
  }
}
