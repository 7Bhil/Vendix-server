import {
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
    return this.prisma.categories.create({
      data: {
        commerce_id: commerceId,
        name: dto.name.trim(),
      },
    });
  }

  async update(commerceId: string, id: string, dto: UpdateCategoryDto) {
    await this.findOne(commerceId, id);

    return this.prisma.categories.update({
      where: { id },
      data: {
        name: dto.name.trim(),
      },
    });
  }

  async remove(commerceId: string, id: string) {
    await this.findOne(commerceId, id);

    return this.prisma.categories.delete({
      where: { id },
    });
  }
}
