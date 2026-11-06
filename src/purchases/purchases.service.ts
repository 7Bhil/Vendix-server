import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePurchaseDto } from './dto/purchase.dto.js';
import {
  Prisma,
  PurchaseStatus,
  StockMovementType,
  SyncStatus,
} from '@prisma/client';

@Injectable()
export class PurchasesService {
  constructor(private readonly prisma: PrismaService) {}

  private isReceivedStatus(status: PurchaseStatus): boolean {
    return status === PurchaseStatus.RECEIVED || status === PurchaseStatus.COMPLETED;
  }

  async findAll(commerceId: string, limit = 50) {
    return this.prisma.purchases.findMany({
      where: { commerce_id: commerceId },
      include: {
        supplier: true,
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

  async findOne(commerceId: string, id: string) {
    const purchase = await this.prisma.purchases.findFirst({
      where: { id, commerce_id: commerceId },
      include: {
        supplier: true,
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!purchase) {
      throw new NotFoundException('Commande d’achat introuvable.');
    }

    return purchase;
  }

  async create(commerceId: string, dto: CreatePurchaseDto) {
    if (!dto.lines || dto.lines.length === 0) {
      throw new BadRequestException(
        'Une commande d’achat doit contenir au moins une ligne de produit.',
      );
    }

    // Gestion de l'idempotence si client_op_uuid est fourni
    if (dto.client_op_uuid) {
      const existingSync = await this.prisma.sync_operations.findUnique({
        where: { client_op_uuid: dto.client_op_uuid },
      });

      if (existingSync && existingSync.commerce_id === commerceId) {
        const existingPurchase = await this.prisma.purchases.findFirst({
          where: { commerce_id: commerceId, id: dto.client_op_uuid },
          include: { supplier: true, items: true },
        });
        if (existingPurchase) {
          return existingPurchase;
        }
      }
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Vérifier que le fournisseur appartient bien au commerce (isolation BOLA)
      const supplier = await tx.suppliers.findFirst({
        where: { id: dto.supplier_id, commerce_id: commerceId },
      });

      if (!supplier) {
        throw new NotFoundException('Fournisseur introuvable.');
      }

      // 2. Vérifier et calculer chaque ligne d'achat
      let totalCost = 0;
      const computedItems: Prisma.purchase_itemsUncheckedCreateWithoutPurchaseInput[] = [];
      const stockEntries: Prisma.stock_movementsUncheckedCreateInput[] = [];

      for (const line of dto.lines) {
        const product = await tx.products.findFirst({
          where: { id: line.product_id, commerce_id: commerceId, is_archived: false },
          include: { product_units: true },
        });

        if (!product) {
          throw new NotFoundException(`Produit ID ${line.product_id} introuvable.`);
        }

        const unit = product.product_units.find(
          (u) => u.label.toLowerCase() === line.unit_label.toLowerCase(),
        );

        const conversionFactor = line.conversion_factor || Number(unit?.conversion_factor || 1);
        const unitCost = line.unit_cost;
        const subtotal = Math.round(Number(line.quantity) * unitCost);
        totalCost += subtotal;

        computedItems.push({
          product_id: product.id,
          quantity: line.quantity,
          unit_label_snapshot: line.unit_label,
          conversion_rate_snap: conversionFactor,
          unit_cost_snapshot: unitCost,
          subtotal,
        });

        // Quantité d'entrée en stock dans l'unité de référence
        const baseQtyDelta = Number(line.quantity) * conversionFactor;
        stockEntries.push({
          commerce_id: commerceId,
          product_id: product.id,
          type: StockMovementType.PURCHASE,
          quantity_delta: baseQtyDelta,
          reason: `Réception commande fournisseur (${supplier.name})`,
        });
      }

      // 3. Calcul financier : dette fournisseur
      const debtAmount = Math.max(0, totalCost - dto.amount_paid);
      const purchaseStatus = dto.status || PurchaseStatus.PENDING;

      // 4. Enregistrer la commande d'achat et ses lignes
      const purchase = await tx.purchases.create({
        data: {
          id: dto.client_op_uuid || undefined,
          commerce_id: commerceId,
          supplier_id: dto.supplier_id,
          total_cost: totalCost,
          amount_paid: dto.amount_paid,
          debt_amount: debtAmount,
          payment_method: dto.payment_method,
          status: purchaseStatus,
          items: {
            create: computedItems,
          },
        },
        include: {
          supplier: true,
          items: true,
        },
      });

      // 5. Si le statut est RECEIVED (ou COMPLETED), incrémenter immédiatement le stock
      if (this.isReceivedStatus(purchaseStatus)) {
        for (const entry of stockEntries) {
          await tx.stock_movements.create({
            data: entry,
          });
        }
      }

      // 6. Mettre à jour l'encours de dette fournisseur si applicable
      if (debtAmount > 0) {
        await tx.suppliers.update({
          where: { id: dto.supplier_id },
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
            action_type: 'PURCHASE_CREATE',
            status: SyncStatus.APPLIED,
          },
        });
      }

      return purchase;
    });
  }

  async receiveOrder(commerceId: string, id: string) {
    const purchase = await this.findOne(commerceId, id);

    if (this.isReceivedStatus(purchase.status)) {
      throw new BadRequestException('Cette commande d’achat a déjà été réceptionnée.');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.purchases.update({
        where: { id },
        data: { status: PurchaseStatus.RECEIVED },
        include: {
          supplier: true,
          items: true,
        },
      });

      for (const item of purchase.items) {
        const baseQtyDelta = Number(item.quantity) * Number(item.conversion_rate_snap);
        await tx.stock_movements.create({
          data: {
            commerce_id: commerceId,
            product_id: item.product_id,
            type: StockMovementType.PURCHASE,
            quantity_delta: baseQtyDelta,
            reason: `Réception commande fournisseur (${purchase.supplier.name})`,
          },
        });
      }

      return updated;
    });
  }
}

