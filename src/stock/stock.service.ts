import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StockMovementType, SyncStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreateStockMovementDto,
  ManualStockMotif,
  StockLevel,
} from './dto/stock.dto.js';

export const DEFAULT_LOW_STOCK_THRESHOLD = 5;

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Convertit le motif métier (ENTRY, LOSS, CORRECTION) ou Prisma vers le couple (StockMovementType, ManualStockMotif, libellé par défaut).
   */
  private resolveManualMotif(rawMotif?: string): {
    prismaType: StockMovementType;
    motif: ManualStockMotif;
    defaultReason: string;
  } | null {
    if (!rawMotif) return null;
    const normalized = rawMotif.trim().toUpperCase();

    switch (normalized) {
      case ManualStockMotif.ENTRY:
      case StockMovementType.PURCHASE_ENTRY:
        return {
          prismaType: StockMovementType.PURCHASE_ENTRY,
          motif: ManualStockMotif.ENTRY,
          defaultReason: 'Entrée de marchandise',
        };
      case ManualStockMotif.LOSS:
      case StockMovementType.INVENTORY_LOSS:
        return {
          prismaType: StockMovementType.INVENTORY_LOSS,
          motif: ManualStockMotif.LOSS,
          defaultReason: 'Perte / Casse / Avarie',
        };
      case ManualStockMotif.CORRECTION:
      case StockMovementType.MANUAL_ADJUST:
        return {
          prismaType: StockMovementType.MANUAL_ADJUST,
          motif: ManualStockMotif.CORRECTION,
          defaultReason: 'Ajustement inventaire',
        };
      default:
        return null;
    }
  }

  /**
   * Convertit un StockMovementType Prisma en motif métier lisible par le frontend (/app/stock).
   */
  private mapPrismaTypeToMotif(type: StockMovementType): string {
    switch (type) {
      case StockMovementType.PURCHASE:
      case StockMovementType.PURCHASE_ENTRY:
        return ManualStockMotif.ENTRY;
      case StockMovementType.INVENTORY_LOSS:
        return ManualStockMotif.LOSS;
      case StockMovementType.MANUAL_ADJUST:
        return ManualStockMotif.CORRECTION;
      case StockMovementType.SALE:
        return 'SALE';
      default:
        return 'OTHER';
    }
  }

  /**
   * Calcule le niveau de stock (OUT_OF_STOCK, LOW, NORMAL) selon le stock courant et le seuil d'alerte.
   */
  private computeStockLevel(currentStock: number, threshold: number): StockLevel {
    if (currentStock <= 0) {
      return StockLevel.OUT_OF_STOCK;
    }
    if (currentStock <= threshold) {
      return StockLevel.LOW;
    }
    return StockLevel.NORMAL;
  }

  /**
   * GET /api/v1/stock
   * État global du stock avec filtres par niveau (NORMAL, LOW, OUT_OF_STOCK), catégorie et recherche.
   */
  async getStockState(
    commerceId: string,
    query?: {
      level?: string;
      categoryId?: string;
      search?: string;
      threshold?: number;
    },
  ) {
    const alertThreshold =
      query?.threshold !== undefined && !Number.isNaN(Number(query.threshold)) && Number(query.threshold) >= 0
        ? Number(query.threshold)
        : DEFAULT_LOW_STOCK_THRESHOLD;

    const normalizedLevel = query?.level?.trim().toUpperCase();
    if (
      normalizedLevel &&
      normalizedLevel !== 'ALL' &&
      normalizedLevel !== StockLevel.NORMAL &&
      normalizedLevel !== StockLevel.LOW &&
      normalizedLevel !== StockLevel.OUT_OF_STOCK
    ) {
      throw new BadRequestException(
        'Filtre de niveau de stock invalide. Valeurs supportées : NORMAL, LOW, OUT_OF_STOCK.',
      );
    }

    const where: Prisma.productsWhereInput = {
      commerce_id: commerceId,
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

    const products = await this.prisma.products.findMany({
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
    });

    const items = products.map((product) => {
      const currentStock = product.stock_movements.reduce(
        (acc, sm) => acc + Number(sm.quantity_delta),
        0,
      );
      const stockLevel = this.computeStockLevel(currentStock, alertThreshold);
      const baseUnit =
        product.product_units.find((u) => u.is_base_unit) ??
        product.product_units[0] ??
        null;

      const { stock_movements: _, ...rest } = product;

      return {
        ...rest,
        current_stock: currentStock,
        currentStock,
        alert_threshold: alertThreshold,
        alertThreshold,
        stock_level: stockLevel,
        stockLevel,
        base_unit_label: baseUnit ? baseUnit.label : 'Unité',
      };
    });

    if (
      normalizedLevel &&
      (normalizedLevel === StockLevel.NORMAL ||
        normalizedLevel === StockLevel.LOW ||
        normalizedLevel === StockLevel.OUT_OF_STOCK)
    ) {
      return items.filter((item) => item.stock_level === normalizedLevel);
    }

    return items;
  }

  /**
   * POST /api/v1/stock/movements
   * Enregistrement d'un mouvement manuel avec motif obligatoire (ENTRY, LOSS, CORRECTION)
   * et mise à jour du stock produit dans une transaction ACID.
   */
  async recordMovement(commerceId: string, dto: CreateStockMovementDto) {
    const productId = (dto.product_id ?? dto.productId ?? '').trim();
    if (!productId) {
      throw new BadRequestException('L’identifiant du produit (product_id) est obligatoire.');
    }

    const rawMotifCandidate = dto.motif ?? dto.type ?? dto.reason;
    if (!rawMotifCandidate || !rawMotifCandidate.trim()) {
      throw new BadRequestException(
        'Le motif du mouvement de stock est obligatoire (ENTRY, LOSS, CORRECTION).',
      );
    }

    const resolved =
      this.resolveManualMotif(dto.motif) ??
      this.resolveManualMotif(dto.type) ??
      this.resolveManualMotif(dto.reason);

    if (!resolved) {
      throw new BadRequestException(
        'Motif de mouvement invalide. Motifs manuels supportés : ENTRY (Entrée de marchandise), LOSS (Perte / Casse / Avarie), CORRECTION (Ajustement inventaire).',
      );
    }

    const rawQuantity = Number(dto.quantity);
    if (Number.isNaN(rawQuantity) || rawQuantity === 0) {
      throw new BadRequestException('La quantité du mouvement doit être un nombre non nul.');
    }

    if (resolved.motif === ManualStockMotif.ENTRY && rawQuantity <= 0) {
      throw new BadRequestException(
        'La quantité pour une entrée de marchandise (ENTRY) doit être strictement positive.',
      );
    }

    const customReason =
      dto.reason && !this.resolveManualMotif(dto.reason)
        ? dto.reason.trim()
        : resolved.defaultReason;

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.products.findFirst({
        where: {
          id: productId,
          commerce_id: commerceId,
          is_archived: false,
        },
        include: {
          product_units: true,
          stock_movements: {
            select: { quantity_delta: true },
          },
        },
      });

      if (!product) {
        throw new NotFoundException('Produit introuvable dans cette boutique.');
      }

      const previousStock = (product.stock_movements ?? []).reduce(
        (acc, sm) => acc + Number(sm.quantity_delta),
        0,
      );

      let conversionFactor = dto.conversion_factor ? Number(dto.conversion_factor) : 1;
      if (!dto.conversion_factor && dto.unit_label && product.product_units?.length) {
        const matchedUnit = product.product_units.find(
          (u) => u.label.toLowerCase() === dto.unit_label!.trim().toLowerCase(),
        );
        if (matchedUnit) {
          conversionFactor = Number(matchedUnit.conversion_factor);
        }
      }

      let quantityDelta: number;
      if (resolved.motif === ManualStockMotif.ENTRY) {
        quantityDelta = Math.abs(rawQuantity) * conversionFactor;
      } else if (resolved.motif === ManualStockMotif.LOSS) {
        quantityDelta = -Math.abs(rawQuantity) * conversionFactor;
      } else {
        // CORRECTION (Ajustement inventaire : positif ou négatif)
        quantityDelta = rawQuantity * conversionFactor;
      }

      const newStock = previousStock + quantityDelta;
      if (newStock < 0) {
        throw new BadRequestException(
          `Stock insuffisant : ce mouvement ferait passer le stock de ${previousStock} à ${newStock}.`,
        );
      }

      const movement = await tx.stock_movements.create({
        data: {
          id: dto.client_op_uuid || undefined,
          commerce_id: commerceId,
          product_id: product.id,
          type: resolved.prismaType,
          quantity_delta: quantityDelta,
          reason: customReason,
        },
      });

      if (tx.products.update) {
        await tx.products.update({
          where: { id: product.id },
          data: { updated_at: new Date() },
        });
      }

      if (dto.client_op_uuid && tx.sync_operations?.create) {
        await tx.sync_operations.create({
          data: {
            client_op_uuid: dto.client_op_uuid,
            commerce_id: commerceId,
            action_type: 'STOCK_MOVEMENT_CREATE',
            status: SyncStatus.APPLIED,
          },
        });
      }

      return {
        ...movement,
        quantity_delta: Number(movement.quantity_delta),
        motif: resolved.motif,
        previous_stock: previousStock,
        current_stock: newStock,
        currentStock: newStock,
      };
    });
  }

  /**
   * GET /api/v1/stock/movements
   * Historique chronologique des mouvements avec pagination et filtre par produit.
   */
  async getMovementsHistory(
    commerceId: string,
    query?: {
      productId?: string;
      type?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const safePage = Math.max(1, Number(query?.page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(query?.limit) || 20));
    const skip = (safePage - 1) * safeLimit;

    const where: Prisma.stock_movementsWhereInput = {
      commerce_id: commerceId,
    };

    if (query?.productId?.trim()) {
      where.product_id = query.productId.trim();
    }

    if (query?.type?.trim()) {
      const upperType = query.type.trim().toUpperCase();
      if (upperType === 'SALE') {
        where.type = StockMovementType.SALE;
      } else {
        const resolved = this.resolveManualMotif(upperType);
        if (resolved) {
          where.type = resolved.prismaType;
        }
      }
    }

    const [movements, total] = await Promise.all([
      this.prisma.stock_movements.findMany({
        where,
        include: {
          product: {
            select: {
              id: true,
              name: true,
              image_url: true,
              category_id: true,
              product_units: {
                orderBy: { conversion_factor: 'asc' },
              },
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: safeLimit,
      }),
      this.prisma.stock_movements.count({ where }),
    ]);

    return {
      data: movements.map((m) => ({
        ...m,
        quantity_delta: Number(m.quantity_delta),
        motif: this.mapPrismaTypeToMotif(m.type),
      })),
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.max(1, Math.ceil(total / safeLimit)),
      },
    };
  }

  /**
   * GET /api/v1/stock/alerts
   * Liste des produits sous le seuil d'alerte (LOW et OUT_OF_STOCK) pour commande fournisseur.
   */
  async getStockAlerts(commerceId: string, threshold?: number) {
    const alertThreshold =
      threshold !== undefined && !Number.isNaN(Number(threshold)) && Number(threshold) >= 0
        ? Number(threshold)
        : DEFAULT_LOW_STOCK_THRESHOLD;

    const allStock = await this.getStockState(commerceId, {
      threshold: alertThreshold,
    });

    return allStock
      .filter(
        (item) =>
          item.stock_level === StockLevel.OUT_OF_STOCK ||
          item.stock_level === StockLevel.LOW,
      )
      .map((item) => ({
        ...item,
        deficit: Math.max(0, alertThreshold - item.current_stock),
        suggested_order_quantity: Math.max(1, alertThreshold * 2 - item.current_stock),
      }))
      .sort((a, b) => a.current_stock - b.current_stock);
  }

  /**
   * Garantie d'immuabilité du grand livre de stock : aucune suppression de mouvement autorisée.
   */
  async deleteMovement(_commerceId: string, _movementId: string): Promise<never> {
    throw new ForbiddenException(
      'L’historique des mouvements de stock est immuable : aucune suppression de mouvement n’est autorisée.',
    );
  }
}

