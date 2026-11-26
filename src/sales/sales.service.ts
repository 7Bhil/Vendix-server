import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateSaleDto } from './dto/sale.dto.js';
import { Prisma, SaleStatus, StockMovementType, SyncStatus } from '@prisma/client';

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(commerceId: string, limit = 50) {
    return this.prisma.sales.findMany({
      where: { commerce_id: commerceId },
      include: {
        customer: true,
        items: {
          include: {
            product: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
      take: limit,
    });
  }

  async getSummary(
    commerceId: string,
    filters?: { startDate?: string; endDate?: string },
  ) {
    const createdAtFilter: Prisma.DateTimeFilter = {};

    if (filters?.startDate) {
      const parsedStart = new Date(filters.startDate);
      if (Number.isNaN(parsedStart.getTime())) {
        throw new BadRequestException('Le paramètre startDate est invalide.');
      }
      createdAtFilter.gte = parsedStart;
    }

    if (filters?.endDate) {
      const parsedEnd = new Date(filters.endDate);
      if (Number.isNaN(parsedEnd.getTime())) {
        throw new BadRequestException('Le paramètre endDate est invalide.');
      }
      createdAtFilter.lte = parsedEnd;
    }

    if (
      createdAtFilter.gte &&
      createdAtFilter.lte &&
      createdAtFilter.gte > createdAtFilter.lte
    ) {
      throw new BadRequestException(
        'startDate doit être antérieure ou égale à endDate.',
      );
    }

    const sales = await this.prisma.sales.findMany({
      where: {
        commerce_id: commerceId,
        status: { not: SaleStatus.CANCELLED },
        ...(Object.keys(createdAtFilter).length > 0
          ? { created_at: createdAtFilter }
          : {}),
      },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });

    let totalRevenue = 0;
    let costOfGoodsSold = 0;
    const productTotals = new Map<
      string,
      { product_id: string; name: string; quantity: number; revenue: number }
    >();

    for (const sale of sales) {
      totalRevenue += Number(sale.total_amount ?? 0);

      for (const item of sale.items ?? []) {
        const quantity = Number(item.quantity ?? 0);
        const conversion = Number(item.conversion_rate_snap ?? 1);
        const costPrice = Number(item.cost_price_snapshot ?? 0);
        const itemRevenue = Number(
          item.subtotal ?? Math.round(quantity * Number(item.unit_price_snapshot ?? 0)),
        );

        costOfGoodsSold += Math.round(quantity * conversion * costPrice);

        const existing = productTotals.get(item.product_id);
        if (existing) {
          existing.quantity += quantity;
          existing.revenue += itemRevenue;
        } else {
          productTotals.set(item.product_id, {
            product_id: item.product_id,
            name: item.product?.name ?? 'Produit',
            quantity,
            revenue: itemRevenue,
          });
        }
      }
    }

    const topProducts = Array.from(productTotals.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    return {
      total_revenue: totalRevenue,
      cost_of_goods_sold: costOfGoodsSold,
      gross_profit: totalRevenue - costOfGoodsSold,
      top_products: topProducts,
    };
  }

  async findOne(commerceId: string, id: string) {
    const sale = await this.prisma.sales.findFirst({
      where: { id, commerce_id: commerceId },
      include: {
        customer: true,
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!sale) {
      throw new NotFoundException('Vente introuvable.');
    }

    return sale;
  }

  async create(commerceId: string, dto: CreateSaleDto) {
    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException('Une vente doit contenir au moins un article.');
    }

    // Gestion de l'idempotence si client_op_uuid est fourni
    if (dto.client_op_uuid) {
      const existingSync = await this.prisma.sync_operations.findUnique({
        where: { client_op_uuid: dto.client_op_uuid },
      });

      if (existingSync && existingSync.commerce_id === commerceId) {
        const existingSale = await this.prisma.sales.findFirst({
          where: { commerce_id: commerceId, id: dto.client_op_uuid },
          include: { customer: true, items: true },
        });
        if (existingSale) {
          return existingSale;
        }
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Poser un verrou pessimiste en base de données (SELECT ... FOR UPDATE) par produit trié
      // afin d'empêcher deux encaissements simultanés de provoquer une survente (stock négatif)
      const uniqueProductIds = [...new Set(dto.lines.map((l) => l.product_id))].sort();
      if (typeof tx.$queryRaw === 'function') {
        for (const productId of uniqueProductIds) {
          await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId}::uuid AND commerce_id = ${commerceId}::uuid FOR UPDATE`;
        }
      }

      // 2. Vérifier et calculer chaque ligne de vente avec contrôle strict du stock et des unités BDD
      let totalAmount = 0;
      const computedItems: Prisma.sale_itemsUncheckedCreateWithoutSaleInput[] = [];
      const stockDeductions: Prisma.stock_movementsUncheckedCreateInput[] = [];
      const cumulativeRequiredByProduct = new Map<string, number>();

      for (const line of dto.lines) {
        const product = await tx.products.findFirst({
          where: { id: line.product_id, commerce_id: commerceId, is_archived: false },
          include: {
            product_units: true,
            stock_movements: {
              select: { quantity_delta: true },
            },
          },
        });

        if (!product) {
          throw new NotFoundException(`Produit ID ${line.product_id} introuvable.`);
        }

        const requestedUnitKey = line.unit_label.trim().toLowerCase();
        const unit = product.product_units.find(
          (u) =>
            u.id.toLowerCase() === requestedUnitKey ||
            u.label.trim().toLowerCase() === requestedUnitKey,
        );

        if (!unit) {
          throw new BadRequestException(
            `Unité de vente "${line.unit_label}" invalide pour le produit "${product.name ?? product.id}".`,
          );
        }

        // La base de données est l'unique autorité sur le facteur de conversion
        // Une unité de base vaut toujours exactement 1 unité de référence
        const conversionFactor = unit.is_base_unit ? 1 : Number(unit.conversion_factor);
        if (!Number.isFinite(conversionFactor) || conversionFactor <= 0) {
          throw new BadRequestException(
            `Facteur de conversion invalide en base pour l’unité "${unit.label}".`,
          );
        }

        const lineQuantity = Number(line.quantity);
        const requiredBaseQty = lineQuantity * conversionFactor;
        const totalRequiredForProduct =
          (cumulativeRequiredByProduct.get(product.id) ?? 0) + requiredBaseQty;
        cumulativeRequiredByProduct.set(product.id, totalRequiredForProduct);

        // Règle d'Or n°2 : la vente en stock négatif est autorisée au comptoir.
        // Le stock peut devenir négatif et sera régularisé lors du réapprovisionnement.
        const unitPrice = line.unit_price;
        const subtotal = Math.round(lineQuantity * unitPrice);
        totalAmount += subtotal;

        computedItems.push({
          product_id: product.id,
          quantity: line.quantity,
          unit_label_snapshot: unit.label,
          conversion_rate_snap: conversionFactor,
          unit_price_snapshot: unitPrice,
          cost_price_snapshot: product.default_cost_price,
          subtotal,
        });

        // Quantité de déduction dans l'unité de référence
        const baseQtyDelta = -requiredBaseQty;
        stockDeductions.push({
          commerce_id: commerceId,
          product_id: product.id,
          type: StockMovementType.SALE,
          quantity_delta: baseQtyDelta,
          reason: 'Vente comptoir',
        });
      }

      // 2. Vérification d'étanchéité multi-tenant du client (Anti-BOLA/IDOR)
      if (dto.customer_id && typeof tx.customers?.findFirst === 'function') {
        const customer = await tx.customers.findFirst({
          where: { id: dto.customer_id, commerce_id: commerceId },
        });
        if (!customer) {
          throw new NotFoundException('Client introuvable dans votre boutique.');
        }
      }
      // 3. Calcul financier : dette et monnaie
      const debtAmount = Math.max(0, totalAmount - dto.amount_paid);

      // Si c'est une vente à crédit (partiel ou total), un client est obligatoire
      if (debtAmount > 0 && !dto.customer_id) {
        throw new BadRequestException(
          'Un client doit être désigné pour toute vente comportant un crédit ou un reste dû.',
        );
      }

      // 4. Enregistrer la vente et ses snapshots
      const sale = await tx.sales.create({
        data: {
          id: dto.client_op_uuid || undefined,
          commerce_id: commerceId,
          customer_id: dto.customer_id || null,
          total_amount: totalAmount,
          amount_paid: dto.amount_paid,
          debt_amount: debtAmount,
          payment_method: dto.payment_method,
          status: SaleStatus.COMPLETED,
          items: {
            create: computedItems,
          },
        },
        include: {
          customer: true,
          items: true,
        },
      });

      // 5. Décrémenter le stock via le grand livre immuable
      for (const deduction of stockDeductions) {
        await tx.stock_movements.create({
          data: deduction,
        });
      }

      // 6. Mettre à jour l'encours de dette client si applicable
      if (debtAmount > 0 && dto.customer_id) {
        await tx.customers.update({
          where: { id: dto.customer_id },
          data: {
            outstanding_debt: { increment: debtAmount },
          },
        });
      }

      // 7. Idempotence sync
      if (dto.client_op_uuid) {
        await tx.sync_operations.create({
          data: {
            client_op_uuid: dto.client_op_uuid,
            commerce_id: commerceId,
            action_type: 'SALE_CREATE',
            status: SyncStatus.APPLIED,
          },
        });
      }

      return sale;
    });
  }
}
