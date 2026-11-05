import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto.js';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(commerceId: string) {
    return this.prisma.categories.findMany({
      where: { commerce_id: commerceId },
      include: {
        _count: {
          select: { products: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(commerceId: string, id: string) {
    const category = await this.prisma.categories.findFirst({
      where: { id, commerce_id: commerceId },
      include: {
        products: {
          where: { is_archived: false },
          include: { product_units: true },
        },
      },
    });

    if (!category) {
      throw new NotFoundException('Catégorie introuvable.');
    }

    return category;
  }

  async create(commerceId: string, dto: CreateCategoryDto) {
    const trimmedName = dto.name.trim();

    const existing = await this.prisma.categories.findFirst({
      where: {
        commerce_id: commerceId,
        name: {
          equals: trimmedName,
          mode: 'insensitive',
        },
      },
    });

    if (existing) {
      throw new ConflictException('Une catégorie avec ce nom existe déjà pour ce commerce.');
    }

    return this.prisma.categories.create({
      data: {
        commerce_id: commerceId,
        name: trimmedName,
      },
    });
  }

  async update(commerceId: string, id: string, dto: UpdateCategoryDto) {
    await this.findOne(commerceId, id);
    const trimmedName = dto.name.trim();

    const conflict = await this.prisma.categories.findFirst({
      where: {
        commerce_id: commerceId,
        name: {
          equals: trimmedName,
          mode: 'insensitive',
        },
        id: { not: id },
      },
    });

    if (conflict) {
      throw new ConflictException('Une catégorie avec ce nom existe déjà pour ce commerce.');
    }

    return this.prisma.categories.update({
      where: { id },
      data: {
        name: trimmedName,
      },
    });
  }

  async remove(commerceId: string, id: string, reassignCategoryId?: string) {
    await this.findOne(commerceId, id);

    const productsCount = await this.prisma.products.count({
      where: { commerce_id: commerceId, category_id: id },
    });

    if (productsCount > 0) {
      if (!reassignCategoryId) {
        throw new BadRequestException(
          'Suppression refusée tant que des produits y sont rattachés, sauf réaffectation.',
        );
      }

      await this.findOne(commerceId, reassignCategoryId);

      await this.prisma.products.updateMany({
        where: { commerce_id: commerceId, category_id: id },
        data: { category_id: reassignCategoryId },
      });
    }

    return this.prisma.categories.delete({
      where: { id },
    });
  }
}
