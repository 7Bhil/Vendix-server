import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreateSupplierDto,
  CreateSupplierPaymentDto,
  UpdateSupplierDto,
} from './dto/supplier.dto.js';
import { PaymentMethod, Prisma } from '@prisma/client';

@Injectable()
export class SuppliersService {
  constructor(private readonly prisma: PrismaService) {}

  private formatSupplier<T extends { phone?: string | null; outstanding_debt: number }>(
    supplier: T,
  ) {
    const cleanPhone = supplier.phone ? supplier.phone.replace(/[^0-9]/g, '') : null;
    const whatsappContact = cleanPhone ? `https://wa.me/${cleanPhone}` : null;

    return {
      ...supplier,
      amountDue: supplier.outstanding_debt,
      whatsappContact,
      whatsapp_url: whatsappContact,
    };
  }

  async findAll(
    commerceId: string,
    filterMode?: 'ALL' | 'CREDITOR' | 'UP_TO_DATE',
    search?: string,
  ) {
    const where: Prisma.suppliersWhereInput = {
      commerce_id: commerceId,
    };

    if (filterMode === 'CREDITOR') {
      where.outstanding_debt = { gt: 0 };
    } else if (filterMode === 'UP_TO_DATE') {
      where.outstanding_debt = 0;
    }

    if (search?.trim()) {
      where.OR = [
        { name: { contains: search.trim(), mode: 'insensitive' } },
        { phone: { contains: search.trim() } },
      ];
    }

    const suppliers = await this.prisma.suppliers.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        _count: {
          select: { purchases: true },
        },
      },
    });

    return suppliers.map((s) => this.formatSupplier(s));
  }

  async findOne(commerceId: string, id: string) {
    const supplier = await this.prisma.suppliers.findFirst({
      where: { id, commerce_id: commerceId },
      include: {
        purchases: {
          orderBy: { created_at: 'desc' },
          take: 20,
          include: {
            items: {
              include: { product: true },
            },
          },
        },
        payments: {
          orderBy: { created_at: 'desc' },
          take: 20,
        },
      },
    });

    if (!supplier) {
      throw new NotFoundException('Fiche fournisseur introuvable.');
    }

    return this.formatSupplier(supplier);
  }

  async create(commerceId: string, dto: CreateSupplierDto) {
    const trimmedPhone = dto.phone?.trim();

    if (trimmedPhone) {
      const existing = await this.prisma.suppliers.findFirst({
        where: {
          commerce_id: commerceId,
          phone: trimmedPhone,
        },
      });

      if (existing) {
        throw new ConflictException(
          'Un fournisseur avec ce numéro de téléphone existe déjà dans votre boutique.',
        );
      }
    }

    const created = await this.prisma.suppliers.create({
      data: {
        commerce_id: commerceId,
        name: dto.name.trim(),
        phone: trimmedPhone || null,
        outstanding_debt: 0,
      },
    });

    return this.formatSupplier(created);
  }

  async update(commerceId: string, id: string, dto: UpdateSupplierDto) {
    await this.findOne(commerceId, id);

    if (dto.phone) {
      const conflict = await this.prisma.suppliers.findFirst({
        where: {
          commerce_id: commerceId,
          phone: dto.phone.trim(),
          id: { not: id },
        },
      });

      if (conflict) {
        throw new ConflictException(
          'Ce numéro de téléphone est déjà attribué à un autre fournisseur.',
        );
      }
    }

    const data: Prisma.suppliersUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.phone !== undefined) data.phone = dto.phone.trim();

    const updated = await this.prisma.suppliers.update({
      where: { id },
      data,
    });

    return this.formatSupplier(updated);
  }

  async recordPayment(commerceId: string, id: string, dto: CreateSupplierPaymentDto) {
    const supplier = await this.findOne(commerceId, id);

    if (supplier.outstanding_debt <= 0) {
      throw new BadRequestException(
        'Aucune dette en cours envers ce fournisseur à régler.',
      );
    }

    if (dto.amount > supplier.outstanding_debt) {
      throw new BadRequestException(
        `Le montant du versement (${dto.amount} FCFA) ne peut pas excéder la dette fournisseur (${supplier.outstanding_debt} FCFA).`,
      );
    }

    const paymentMethod = dto.payment_method || PaymentMethod.CASH;

    return this.prisma.$transaction(async (tx) => {
      // 1. Enregistrer le versement fournisseur
      const payment = await tx.supplier_payments.create({
        data: {
          commerce_id: commerceId,
          supplier_id: id,
          amount: dto.amount,
          payment_method: paymentMethod,
          notes: dto.notes?.trim() || null,
        },
      });

      // 2. Déduire de l'encours de dette du fournisseur
      const updatedSupplier = await tx.suppliers.update({
        where: { id },
        data: {
          outstanding_debt: { decrement: dto.amount },
        },
      });

      // 3. Imputation FIFO sur les commandes d'achat impayées les plus anciennes
      let remainingToImpute = dto.amount;
      const unpaidPurchases = await tx.purchases.findMany({
        where: {
          commerce_id: commerceId,
          supplier_id: id,
          debt_amount: { gt: 0 },
        },
        orderBy: { created_at: 'asc' },
      });

      for (const purchase of unpaidPurchases) {
        if (remainingToImpute <= 0) break;

        const deduction = Math.min(purchase.debt_amount, remainingToImpute);
        const newDebt = purchase.debt_amount - deduction;
        const newPaid = purchase.amount_paid + deduction;

        await tx.purchases.update({
          where: { id: purchase.id },
          data: {
            debt_amount: newDebt,
            amount_paid: newPaid,
          },
        });

        remainingToImpute -= deduction;
      }

      return {
        payment,
        supplier: this.formatSupplier(updatedSupplier),
      };
    });
  }
}

