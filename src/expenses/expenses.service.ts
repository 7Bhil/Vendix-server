import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SyncStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CreateExpenseDto,
  ExpenseCategory,
  ExpensePaymentMethod,
} from './dto/expense.dto.js';

export interface ExpenseMetadataDetails {
  commerce_id?: string;
  expense_id?: string;
  category?: string;
  payment_method?: string;
  mode?: string;
  motif?: string;
  reason?: string;
}

export interface EnrichedExpense {
  id: string;
  commerce_id: string;
  category: ExpenseCategory;
  amount: number;
  payment_method: ExpensePaymentMethod;
  mode: ExpensePaymentMethod;
  motif: string | null;
  reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface FindExpensesQuery {
  page?: number;
  limit?: number;
  month?: number;
  year?: number;
  category?: string;
  payment_method?: string;
  mode?: string;
  startDate?: string;
  endDate?: string;
}

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  private resolveCategory(rawCategory?: string): ExpenseCategory {
    const normalized = rawCategory?.trim().toUpperCase();
    switch (normalized) {
      case ExpenseCategory.RENT:
        return ExpenseCategory.RENT;
      case ExpenseCategory.TRANSPORT:
        return ExpenseCategory.TRANSPORT;
      case ExpenseCategory.ELECTRICITY:
        return ExpenseCategory.ELECTRICITY;
      case ExpenseCategory.PACKAGING:
        return ExpenseCategory.PACKAGING;
      case ExpenseCategory.OTHER:
        return ExpenseCategory.OTHER;
      default:
        throw new BadRequestException(
          'Catégorie de dépense invalide. Valeurs autorisées : RENT, TRANSPORT, ELECTRICITY, PACKAGING, OTHER.',
        );
    }
  }

  private resolvePaymentMethod(rawMethod?: string): ExpensePaymentMethod {
    const normalized = rawMethod?.trim().toUpperCase();
    if (normalized === ExpensePaymentMethod.CASH) {
      return ExpensePaymentMethod.CASH;
    }
    if (normalized === ExpensePaymentMethod.MOMO) {
      return ExpensePaymentMethod.MOMO;
    }
    throw new BadRequestException(
      'Mode de paiement de dépense invalide. Valeurs autorisées : CASH ou MOMO.',
    );
  }

  private extractMetadata(
    expense: {
      id: string;
      category: string;
      payment_method?: string;
      mode?: string;
      motif?: string | null;
      reason?: string | null;
    },
    auditMap: Map<string, ExpenseMetadataDetails>,
  ): {
    category: ExpenseCategory;
    payment_method: ExpensePaymentMethod;
    motif: string | null;
  } {
    const details = auditMap.get(expense.id);

    const rawCat = expense.category?.includes(':')
      ? expense.category.split(':')[0]
      : expense.category;
    const category = Object.values(ExpenseCategory).includes(rawCat as ExpenseCategory)
      ? (rawCat as ExpenseCategory)
      : ExpenseCategory.OTHER;

    const rawMode =
      expense.payment_method ??
      expense.mode ??
      details?.payment_method ??
      details?.mode ??
      (expense.category?.includes(':') ? expense.category.split(':')[1] : undefined) ??
      ExpensePaymentMethod.CASH;

    const payment_method =
      rawMode.toUpperCase() === ExpensePaymentMethod.MOMO
        ? ExpensePaymentMethod.MOMO
        : ExpensePaymentMethod.CASH;

    const motif =
      expense.motif !== undefined
        ? expense.motif
        : expense.reason !== undefined
          ? expense.reason
          : (details?.motif ?? details?.reason ?? null);

    return { category, payment_method, motif };
  }

  /**
   * GET /api/v1/expenses
   * Liste paginée des dépenses du mois en cours avec cumul total.
   */
  async findAll(commerceId: string, query?: FindExpensesQuery) {
    const safePage = Math.max(1, Number(query?.page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(query?.limit) || 20));

    const now = new Date();
    const targetYear =
      query?.year !== undefined && !Number.isNaN(Number(query.year))
        ? Number(query.year)
        : now.getFullYear();
    const targetMonth =
      query?.month !== undefined &&
      !Number.isNaN(Number(query.month)) &&
      Number(query.month) >= 1 &&
      Number(query.month) <= 12
        ? Number(query.month)
        : now.getMonth() + 1;

    const periodStart = query?.startDate
      ? new Date(query.startDate)
      : new Date(targetYear, targetMonth - 1, 1, 0, 0, 0, 0);
    const periodEnd = query?.endDate
      ? new Date(query.endDate)
      : new Date(targetYear, targetMonth, 0, 23, 59, 59, 999);

    if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
      throw new BadRequestException('Plage de dates invalide.');
    }

    const where: Prisma.expensesWhereInput = {
      commerce_id: commerceId,
      created_at: {
        gte: periodStart,
        lte: periodEnd,
      },
    };

    if (query?.category?.trim()) {
      where.category = this.resolveCategory(query.category);
    }

    const filterModeRaw = (query?.payment_method ?? query?.mode)?.trim();
    const filterMode = filterModeRaw ? this.resolvePaymentMethod(filterModeRaw) : undefined;

    const allMonthExpenses = await this.prisma.expenses.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });

    const auditMap = new Map<string, ExpenseMetadataDetails>();
    if (allMonthExpenses.length > 0 && this.prisma.audit_logs?.findMany) {
      const logs = await this.prisma.audit_logs.findMany({
        where: {
          id: { in: allMonthExpenses.map((e) => e.id) },
        },
      });
      for (const log of logs) {
        if (log.details && typeof log.details === 'object' && !Array.isArray(log.details)) {
          auditMap.set(log.id, log.details as ExpenseMetadataDetails);
        }
      }
    }

    const enrichedAll: EnrichedExpense[] = allMonthExpenses.map((exp) => {
      const meta = this.extractMetadata(exp, auditMap);
      return {
        id: exp.id,
        commerce_id: exp.commerce_id,
        category: meta.category,
        amount: Math.round(Number(exp.amount)),
        payment_method: meta.payment_method,
        mode: meta.payment_method,
        motif: meta.motif,
        reason: meta.motif,
        created_at: exp.created_at,
        updated_at: exp.updated_at,
      };
    });

    const filteredExpenses = filterMode
      ? enrichedAll.filter((e) => e.payment_method === filterMode)
      : enrichedAll;

    let totalAmount = 0;
    let cashTotal = 0;
    let momoTotal = 0;
    const byCategory: Record<ExpenseCategory, number> = {
      [ExpenseCategory.RENT]: 0,
      [ExpenseCategory.TRANSPORT]: 0,
      [ExpenseCategory.ELECTRICITY]: 0,
      [ExpenseCategory.PACKAGING]: 0,
      [ExpenseCategory.OTHER]: 0,
    };

    for (const exp of filteredExpenses) {
      totalAmount += exp.amount;
      if (exp.payment_method === ExpensePaymentMethod.MOMO) {
        momoTotal += exp.amount;
      } else {
        cashTotal += exp.amount;
      }
      byCategory[exp.category] = (byCategory[exp.category] ?? 0) + exp.amount;
    }

    const totalCount = filteredExpenses.length;
    const skip = (safePage - 1) * safeLimit;
    const paginatedData = filteredExpenses.slice(skip, skip + safeLimit);

    return {
      data: paginatedData,
      total_amount: totalAmount,
      totalAmount,
      cumulative_total: totalAmount,
      summary: {
        total_amount: totalAmount,
        cash_total: cashTotal,
        momo_total: momoTotal,
        count: totalCount,
        by_category: byCategory,
      },
      meta: {
        total: totalCount,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.max(1, Math.ceil(totalCount / safeLimit)),
        total_amount: totalAmount,
        month: targetMonth,
        year: targetYear,
        period_start: periodStart,
        period_end: periodEnd,
      },
    };
  }

  /**
   * POST /api/v1/expenses
   * Enregistrement d'une dépense (montant FCFA entier, catégorie, mode CASH ou MOMO, motif).
   */
  async create(commerceId: string, dto: CreateExpenseDto): Promise<EnrichedExpense> {
    if (
      typeof dto.amount !== 'number' ||
      !Number.isInteger(dto.amount) ||
      dto.amount < 1
    ) {
      throw new BadRequestException(
        'Le montant de la dépense doit être un entier strictement positif en FCFA (sans centimes).',
      );
    }

    const category = this.resolveCategory(dto.category);
    const paymentMethod = this.resolvePaymentMethod(dto.payment_method ?? dto.mode);
    const motif = (dto.motif ?? dto.reason ?? dto.description)?.trim();

    if (!motif) {
      throw new BadRequestException('Le motif de la dépense est obligatoire.');
    }

    if (dto.client_op_uuid && this.prisma.sync_operations?.findUnique) {
      const existingSync = await this.prisma.sync_operations.findUnique({
        where: { client_op_uuid: dto.client_op_uuid },
      });

      if (existingSync && existingSync.commerce_id === commerceId) {
        const existingExpense = await this.prisma.expenses.findFirst({
          where: { id: dto.client_op_uuid, commerce_id: commerceId },
        });
        if (existingExpense) {
          const auditMap = new Map<string, ExpenseMetadataDetails>();
          if (this.prisma.audit_logs?.findUnique) {
            const log = await this.prisma.audit_logs.findUnique({
              where: { id: existingExpense.id },
            });
            if (log?.details && typeof log.details === 'object' && !Array.isArray(log.details)) {
              auditMap.set(log.id, log.details as ExpenseMetadataDetails);
            }
          }
          const meta = this.extractMetadata(existingExpense, auditMap);
          return {
            id: existingExpense.id,
            commerce_id: existingExpense.commerce_id,
            category: meta.category,
            amount: existingExpense.amount,
            payment_method: meta.payment_method,
            mode: meta.payment_method,
            motif: meta.motif ?? motif,
            reason: meta.motif ?? motif,
            created_at: existingExpense.created_at,
            updated_at: existingExpense.updated_at,
          };
        }
      }
    }

    const executeCreation = async (tx: Prisma.TransactionClient) => {
      const created = await tx.expenses.create({
        data: {
          id: dto.client_op_uuid || undefined,
          commerce_id: commerceId,
          category,
          amount: dto.amount,
        },
      });

      if (tx.audit_logs?.create) {
        await tx.audit_logs.create({
          data: {
            id: created.id,
            event_type: 'EXPENSE_CREATE',
            details: {
              commerce_id: commerceId,
              expense_id: created.id,
              category,
              payment_method: paymentMethod,
              mode: paymentMethod,
              motif,
            },
          },
        });
      }

      if (dto.client_op_uuid && tx.sync_operations?.create) {
        await tx.sync_operations.create({
          data: {
            client_op_uuid: dto.client_op_uuid,
            commerce_id: commerceId,
            action_type: 'EXPENSE_CREATE',
            status: SyncStatus.APPLIED,
          },
        });
      }

      return {
        id: created.id,
        commerce_id: created.commerce_id,
        category,
        amount: created.amount,
        payment_method: paymentMethod,
        mode: paymentMethod,
        motif,
        reason: motif,
        created_at: created.created_at,
        updated_at: created.updated_at,
      };
    };

    if (this.prisma.$transaction) {
      return this.prisma.$transaction(executeCreation);
    }

    return executeCreation(this.prisma);
  }

  /**
   * DELETE /api/v1/expenses/:id
   * Annulation d'une dépense saisie par erreur (avec isolation multi-tenant BOLA).
   */
  async remove(commerceId: string, id: string) {
    const expense = await this.prisma.expenses.findFirst({
      where: {
        id,
        commerce_id: commerceId,
      },
    });

    if (!expense) {
      throw new NotFoundException('Dépense introuvable.');
    }

    await this.prisma.expenses.delete({
      where: { id: expense.id },
    });

    if (this.prisma.audit_logs?.deleteMany) {
      await this.prisma.audit_logs.deleteMany({
        where: { id: expense.id },
      });
    }

    return {
      id: expense.id,
      deleted: true,
      message: 'Dépense annulée avec succès.',
    };
  }
}

