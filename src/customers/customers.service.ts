import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCustomerDto, CreateRepaymentDto, UpdateCustomerDto } from './dto/customer.dto.js';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(commerceId: string, filterMode?: 'ALL' | 'DEBTORS' | 'UP_TO_DATE', search?: string) {
    const where: any = {
      commerce_id: commerceId,
    };

    if (filterMode === 'DEBTORS') {
      where.outstanding_debt = { gt: 0 };
    } else if (filterMode === 'UP_TO_DATE') {
      where.outstanding_debt = 0;
    }

    if (search?.trim()) {
      where.OR = [
        { full_name: { contains: search.trim(), mode: 'insensitive' } },
        { phone: { contains: search.trim() } },
      ];
    }

    return this.prisma.customers.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        _count: {
          select: { sales: true },
        },
      },
    });
  }

  async findDebtors(commerceId: string) {
    const debtors = await this.prisma.customers.findMany({
      where: {
        commerce_id: commerceId,
        outstanding_debt: { gt: 0 },
      },
      include: {
        sales: {
          where: { debt_amount: { gt: 0 } },
          orderBy: { created_at: 'asc' },
          take: 1,
        },
      },
      orderBy: { outstanding_debt: 'desc' },
    });

    return debtors.map((customer) => {
      const oldestSale = customer.sales[0];
      const oldestDebtDate = oldestSale ? oldestSale.created_at : customer.created_at;
      const debtAgeDays = Math.max(
        0,
        Math.floor((Date.now() - new Date(oldestDebtDate).getTime()) / (1000 * 60 * 60 * 24)),
      );

      const { sales: _, ...rest } = customer;
      return {
        ...rest,
        oldest_debt_date: oldestDebtDate,
        debt_age_days: debtAgeDays,
      };
    });
  }

  async findOne(commerceId: string, id: string) {
    const customer = await this.prisma.customers.findFirst({
      where: { id, commerce_id: commerceId },
      include: {
        sales: {
          orderBy: { created_at: 'desc' },
          take: 20,
          include: {
            items: {
              include: { product: true },
            },
          },
        },
        repayments: {
          orderBy: { created_at: 'desc' },
          take: 20,
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('Fiche client introuvable.');
    }

    return customer;
  }

  async create(commerceId: string, dto: CreateCustomerDto) {
    const existing = await this.prisma.customers.findFirst({
      where: {
        commerce_id: commerceId,
        phone: dto.phone.trim(),
      },
    });

    if (existing) {
      throw new ConflictException('Un client avec ce numéro de téléphone existe déjà dans votre boutique.');
    }

    return this.prisma.customers.create({
      data: {
        commerce_id: commerceId,
        full_name: dto.full_name.trim(),
        phone: dto.phone.trim(),
        outstanding_debt: 0,
      },
    });
  }

  async update(commerceId: string, id: string, dto: UpdateCustomerDto) {
    await this.findOne(commerceId, id);

    if (dto.phone) {
      const conflict = await this.prisma.customers.findFirst({
        where: {
          commerce_id: commerceId,
          phone: dto.phone.trim(),
          id: { not: id },
        },
      });

      if (conflict) {
        throw new ConflictException('Ce numéro de téléphone est déjà attribué à un autre client.');
      }
    }

    const data: any = {};
    if (dto.full_name !== undefined) data.full_name = dto.full_name.trim();
    if (dto.phone !== undefined) data.phone = dto.phone.trim();

    return this.prisma.customers.update({
      where: { id },
      data,
    });
  }

  async recordRepayment(commerceId: string, id: string, dto: CreateRepaymentDto) {
    const customer = await this.findOne(commerceId, id);

    if (customer.outstanding_debt <= 0) {
      throw new BadRequestException('Ce client n’a aucune dette en cours à rembourser.');
    }

    if (dto.amount > customer.outstanding_debt) {
      throw new BadRequestException(
        `Le montant du remboursement (${dto.amount} FCFA) ne peut pas excéder la dette totale (${customer.outstanding_debt} FCFA).`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Enregistrer l'opération de remboursement
      const repayment = await tx.customer_repayments.create({
        data: {
          commerce_id: commerceId,
          customer_id: id,
          amount: dto.amount,
          payment_method: dto.payment_method,
        },
      });

      // 2. Déduire de l'encours global
      const updatedCustomer = await tx.customers.update({
        where: { id },
        data: {
          outstanding_debt: { decrement: dto.amount },
        },
      });

      // 3. Imputation FIFO sur les ventes impayées les plus anciennes
      let remainingToImpute = dto.amount;
      const unpaidSales = await tx.sales.findMany({
        where: {
          commerce_id: commerceId,
          customer_id: id,
          debt_amount: { gt: 0 },
        },
        orderBy: { created_at: 'asc' },
      });

      for (const sale of unpaidSales) {
        if (remainingToImpute <= 0) break;

        const deduction = Math.min(sale.debt_amount, remainingToImpute);
        const newDebt = sale.debt_amount - deduction;
        const newPaid = sale.amount_paid + deduction;

        await tx.sales.update({
          where: { id: sale.id },
          data: {
            debt_amount: newDebt,
            amount_paid: newPaid,
          },
        });

        remainingToImpute -= deduction;
      }

      return {
        repayment,
        customer: updatedCustomer,
      };
    });
  }

  async getWhatsAppReminder(commerceId: string, id: string) {
    const customer = await this.findOne(commerceId, id);
    const commerce = await this.prisma.commerces.findUnique({
      where: { id: commerceId },
    });

    if (customer.outstanding_debt <= 0) {
      throw new BadRequestException('Ce client n’a aucune dette active nécessitant une relance.');
    }

    const boutiqueName = commerce?.name || 'Vendix';
    const amountFormatted = new Intl.NumberFormat('fr-FR').format(customer.outstanding_debt);
    const message = `Bonjour ${customer.full_name}, nous vous rappelons que votre solde auprès de ${boutiqueName} est de ${amountFormatted} FCFA. Merci de bien vouloir passer faire le point à votre convenance.`;

    const cleanPhone = customer.phone.replace(/[^0-9]/g, '');
    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodedMessage}`;

    return {
      customer_id: customer.id,
      customer_name: customer.full_name,
      phone: customer.phone,
      amount_due: customer.outstanding_debt,
      message,
      whatsapp_url: whatsappUrl,
    };
  }
}
