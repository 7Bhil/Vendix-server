import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { PaymentMethod, Prisma, SaleStatus, SyncStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CashDiscrepancyType, CreateCashClosureDto } from './dto/cash.dto.js';
import { ExpensePaymentMethod } from '../expenses/dto/expense.dto.js';
import { ExpenseMetadataDetails } from '../expenses/expenses.service.js';

export interface ClosureAuditDetails {
  commerce_id?: string;
  cash_session_id?: string;
  date?: string;
  opening_amount?: number;
  cash_sales?: number;
  cash_expenses?: number;
  cash_debt_repayments?: number;
  theoretical_cash?: number;
  actual_cash_counted?: number;
  discrepancy_amount?: number;
  discrepancy_type?: CashDiscrepancyType;
  comment?: string | null;
}

export interface FindClosuresQuery {
  page?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
}

@Injectable()
export class CashService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calcule le type d'écart : 'surplus' (> 0), 'missing' (< 0), ou 'balanced' (=== 0).
   */
  computeDiscrepancyType(discrepancyAmount: number): CashDiscrepancyType {
    if (discrepancyAmount > 0) {
      return CashDiscrepancyType.SURPLUS;
    }
    if (discrepancyAmount < 0) {
      return CashDiscrepancyType.MISSING;
    }
    return CashDiscrepancyType.BALANCED;
  }

  private resolveDayBounds(dateInput?: string): {
    dateStr: string;
    startOfDay: Date;
    endOfDay: Date;
  } {
    const baseDate = dateInput ? new Date(dateInput) : new Date();
    if (Number.isNaN(baseDate.getTime())) {
      throw new BadRequestException('Format de date invalide.');
    }

    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    const day = baseDate.getDate();

    const startOfDay = new Date(year, month, day, 0, 0, 0, 0);
    const endOfDay = new Date(year, month, day, 23, 59, 59, 999);
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    return { dateStr, startOfDay, endOfDay };
  }

  /**
   * GET /api/v1/cash/daily-summary
   * Calcul automatique et déterministe du solde théorique attendu de la journée :
   * Solde théorique = (Fond de caisse initial) + Ventes espèces - Dépenses espèces + Règlements dettes espèces
   */
  async getDailySummary(
    commerceId: string,
    options?: { date?: string; openingAmount?: number },
  ) {
    if (
      options?.openingAmount !== undefined &&
      (!Number.isInteger(options.openingAmount) || options.openingAmount < 0)
    ) {
      throw new BadRequestException(
        'Le montant d’ouverture de caisse doit être un entier positif ou nul en FCFA.',
      );
    }

    const { dateStr, startOfDay, endOfDay } = this.resolveDayBounds(options?.date);

    const [daySales, dayExpenses, dayRepayments] = await Promise.all([
      this.prisma.sales.findMany({
        where: {
          commerce_id: commerceId,
          status: SaleStatus.COMPLETED,
          created_at: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
      }),
      this.prisma.expenses.findMany({
        where: {
          commerce_id: commerceId,
          created_at: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
      }),
      this.prisma.customer_repayments.findMany({
        where: {
          commerce_id: commerceId,
          created_at: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
      }),
    ]);

    // Récupération des métadonnées d'audit pour identifier le mode de paiement (CASH vs MOMO) des dépenses
    const expenseAuditMap = new Map<string, ExpenseMetadataDetails>();
    if (dayExpenses.length > 0 && this.prisma.audit_logs?.findMany) {
      const logs = await this.prisma.audit_logs.findMany({
        where: {
          id: { in: dayExpenses.map((e) => e.id) },
        },
      });
      for (const log of logs) {
        if (log.details && typeof log.details === 'object' && !Array.isArray(log.details)) {
          expenseAuditMap.set(log.id, log.details as ExpenseMetadataDetails);
        }
      }
    }

    // 1. Ventes espèces (CASH) et Mobile Money (MOMO)
    let cashSalesTotal = 0;
    let cashSalesCount = 0;
    let momoSalesTotal = 0;

    for (const sale of daySales) {
      const paidAmount =
        sale.amount_paid !== undefined && sale.amount_paid !== null
          ? sale.total_amount !== undefined && sale.total_amount !== null
            ? Math.min(Math.round(Number(sale.amount_paid)), Math.round(Number(sale.total_amount)))
            : Math.round(Number(sale.amount_paid))
          : Math.round(Number(sale.total_amount ?? 0));

      if (sale.payment_method === PaymentMethod.CASH) {
        cashSalesTotal += paidAmount;
        cashSalesCount += 1;
      } else if (sale.payment_method === PaymentMethod.MOMO) {
        momoSalesTotal += paidAmount;
      }
    }

    // 2. Dépenses espèces (CASH) et Mobile Money (MOMO)
    let cashExpensesTotal = 0;
    let cashExpensesCount = 0;
    let momoExpensesTotal = 0;

    for (const exp of dayExpenses) {
      const expWithOptionalMode = exp as {
        id: string;
        category: string;
        amount: number;
        payment_method?: string;
        mode?: string;
      };
      const auditDetails = expenseAuditMap.get(exp.id);
      const rawMode =
        expWithOptionalMode.payment_method ??
        expWithOptionalMode.mode ??
        auditDetails?.payment_method ??
        auditDetails?.mode ??
        (exp.category?.includes(':') ? exp.category.split(':')[1] : undefined) ??
        ExpensePaymentMethod.CASH;

      const amount = Math.round(Number(exp.amount));
      if (rawMode.toUpperCase() === ExpensePaymentMethod.MOMO) {
        momoExpensesTotal += amount;
      } else {
        cashExpensesTotal += amount;
        cashExpensesCount += 1;
      }
    }

    // 3. Règlements dettes espèces (CASH) et Mobile Money (MOMO)
    let cashRepaymentsTotal = 0;
    let cashRepaymentsCount = 0;
    let momoRepaymentsTotal = 0;

    for (const rep of dayRepayments) {
      const amount = Math.round(Number(rep.amount));
      if (rep.payment_method === PaymentMethod.CASH) {
        cashRepaymentsTotal += amount;
        cashRepaymentsCount += 1;
      } else if (rep.payment_method === PaymentMethod.MOMO) {
        momoRepaymentsTotal += amount;
      }
    }

    // Vérifier s'il existe déjà une session de caisse pour la journée
    let todaySession: {
      id: string;
      opening_amount: number;
      theoretical_cash: number;
      actual_cash_counted: number | null;
      discrepancy_amount: number | null;
      closed_at: Date | null;
    } | null = null;

    if (this.prisma.cash_sessions?.findFirst) {
      todaySession = await this.prisma.cash_sessions.findFirst({
        where: {
          commerce_id: commerceId,
          created_at: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
        orderBy: { created_at: 'desc' },
      });
    }

    const openingAmount =
      options?.openingAmount !== undefined
        ? Math.round(options.openingAmount)
        : todaySession && todaySession.closed_at === null
          ? Math.round(Number(todaySession.opening_amount))
          : 0;

    // Formule déterministe : Fond initial + Ventes espèces - Dépenses espèces + Règlements dettes espèces
    const theoreticalCash =
      openingAmount + cashSalesTotal - cashExpensesTotal + cashRepaymentsTotal;

    return {
      date: dateStr,
      period_start: startOfDay,
      period_end: endOfDay,
      opening_amount: openingAmount,
      cash_sales: cashSalesTotal,
      cash_expenses: cashExpensesTotal,
      cash_debt_repayments: cashRepaymentsTotal,
      cash_repayments: cashRepaymentsTotal,
      theoretical_cash: theoreticalCash,
      expected_cash: theoreticalCash,
      formula: 'opening_amount + cash_sales - cash_expenses + cash_debt_repayments',
      counts: {
        cash_sales_count: cashSalesCount,
        cash_expenses_count: cashExpensesCount,
        cash_repayments_count: cashRepaymentsCount,
      },
      non_cash_summary: {
        momo_sales: momoSalesTotal,
        momo_expenses: momoExpensesTotal,
        momo_repayments: momoRepaymentsTotal,
      },
      is_closed: Boolean(todaySession?.closed_at),
      last_closure: todaySession?.closed_at ? todaySession : null,
    };
  }

  /**
   * POST /api/v1/cash/closure
   * Enregistrement du montant physique réel compté dans le tiroir,
   * calcul automatique de l'écart (surplus ou missing) et commentaire explicatif obligatoire en cas d'écart.
   */
  async createClosure(commerceId: string, dto: CreateCashClosureDto) {
    const actualCashCounted =
      dto.actual_cash_counted ?? dto.physical_cash ?? dto.counted_amount;

    if (
      typeof actualCashCounted !== 'number' ||
      !Number.isInteger(actualCashCounted) ||
      actualCashCounted < 0
    ) {
      throw new BadRequestException(
        'Le montant physique réel compté doit être un entier positif ou nul en FCFA (sans centimes).',
      );
    }

    if (
      dto.opening_amount !== undefined &&
      (!Number.isInteger(dto.opening_amount) || dto.opening_amount < 0)
    ) {
      throw new BadRequestException(
        'Le montant d’ouverture doit être un entier positif ou nul en FCFA (sans centimes).',
      );
    }

    // Gestion de l'idempotence si client_op_uuid est fourni
    if (dto.client_op_uuid && this.prisma.sync_operations?.findUnique) {
      const existingSync = await this.prisma.sync_operations.findUnique({
        where: { client_op_uuid: dto.client_op_uuid },
      });

      if (existingSync && existingSync.commerce_id === commerceId) {
        const existingClosure = await this.prisma.cash_sessions.findFirst({
          where: { id: dto.client_op_uuid, commerce_id: commerceId },
        });
        if (existingClosure) {
          const discrepancy = existingClosure.discrepancy_amount ?? 0;
          const discrepancyType = this.computeDiscrepancyType(discrepancy);
          const comment = (dto.comment ?? dto.notes ?? dto.explanation)?.trim() || null;
          return {
            ...existingClosure,
            discrepancy_type: discrepancyType,
            status: discrepancyType,
            comment,
            notes: comment,
          };
        }
      }
    }

    const summary = await this.getDailySummary(commerceId, {
      date: dto.date,
      openingAmount: dto.opening_amount,
    });

    const theoreticalCash = summary.theoretical_cash;
    const discrepancyAmount = actualCashCounted - theoreticalCash;
    const discrepancyType = this.computeDiscrepancyType(discrepancyAmount);
    const comment = (dto.comment ?? dto.notes ?? dto.explanation)?.trim() || null;

    // Règle métier stricte : commentaire explicatif obligatoire en cas d'écart (surplus ou missing)
    if (discrepancyAmount !== 0 && !comment) {
      throw new BadRequestException(
        'Un commentaire explicatif est obligatoire en cas d’écart de caisse (surplus ou missing).',
      );
    }

    const closedAt = new Date();

    const executeClosure = async (tx: Prisma.TransactionClient) => {
      const session = await tx.cash_sessions.create({
        data: {
          id: dto.client_op_uuid || undefined,
          commerce_id: commerceId,
          opening_amount: summary.opening_amount,
          theoretical_cash: theoreticalCash,
          actual_cash_counted: actualCashCounted,
          discrepancy_amount: discrepancyAmount,
          closed_at: closedAt,
        },
      });

      if (tx.audit_logs?.create) {
        await tx.audit_logs.create({
          data: {
            id: session.id,
            event_type: 'CASH_CLOSURE',
            details: {
              commerce_id: commerceId,
              cash_session_id: session.id,
              date: summary.date,
              opening_amount: summary.opening_amount,
              cash_sales: summary.cash_sales,
              cash_expenses: summary.cash_expenses,
              cash_debt_repayments: summary.cash_debt_repayments,
              theoretical_cash: theoreticalCash,
              actual_cash_counted: actualCashCounted,
              discrepancy_amount: discrepancyAmount,
              discrepancy_type: discrepancyType,
              comment,
            },
          },
        });
      }

      if (dto.client_op_uuid && tx.sync_operations?.create) {
        await tx.sync_operations.create({
          data: {
            client_op_uuid: dto.client_op_uuid,
            commerce_id: commerceId,
            action_type: 'CASH_CLOSURE',
            status: SyncStatus.APPLIED,
          },
        });
      }

      return {
        ...session,
        discrepancy_type: discrepancyType,
        status: discrepancyType,
        comment,
        notes: comment,
        breakdown: {
          date: summary.date,
          opening_amount: summary.opening_amount,
          cash_sales: summary.cash_sales,
          cash_expenses: summary.cash_expenses,
          cash_debt_repayments: summary.cash_debt_repayments,
          theoretical_cash: theoreticalCash,
        },
      };
    };

    if (this.prisma.$transaction) {
      return this.prisma.$transaction(executeClosure);
    }

    return executeClosure(this.prisma);
  }

  /**
   * GET /api/v1/cash/closures
   * Historique des clôtures de caisse passées avec pagination.
   */
  async getClosuresHistory(commerceId: string, query?: FindClosuresQuery) {
    const safePage = Math.max(1, Number(query?.page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(query?.limit) || 20));
    const skip = (safePage - 1) * safeLimit;

    const where: Prisma.cash_sessionsWhereInput = {
      commerce_id: commerceId,
      closed_at: { not: null },
    };

    if (query?.startDate || query?.endDate) {
      const dateFilter: Prisma.DateTimeNullableFilter = { not: null };
      if (query.startDate) {
        const start = new Date(query.startDate);
        if (Number.isNaN(start.getTime())) {
          throw new BadRequestException('Date de début invalide.');
        }
        dateFilter.gte = start;
      }
      if (query.endDate) {
        const end = new Date(query.endDate);
        if (Number.isNaN(end.getTime())) {
          throw new BadRequestException('Date de fin invalide.');
        }
        dateFilter.lte = end;
      }
      where.closed_at = dateFilter;
    }

    const [sessions, totalCount] = await Promise.all([
      this.prisma.cash_sessions.findMany({
        where,
        orderBy: { closed_at: 'desc' },
        skip,
        take: safeLimit,
      }),
      this.prisma.cash_sessions.count({ where }),
    ]);

    const auditMap = new Map<string, ClosureAuditDetails>();
    if (sessions.length > 0 && this.prisma.audit_logs?.findMany) {
      const logs = await this.prisma.audit_logs.findMany({
        where: {
          id: { in: sessions.map((s) => s.id) },
        },
      });
      for (const log of logs) {
        if (log.details && typeof log.details === 'object' && !Array.isArray(log.details)) {
          auditMap.set(log.id, log.details as ClosureAuditDetails);
        }
      }
    }

    const data = sessions.map((session) => {
      const details = auditMap.get(session.id);
      const discrepancyAmount =
        session.discrepancy_amount !== null && session.discrepancy_amount !== undefined
          ? Math.round(Number(session.discrepancy_amount))
          : (session.actual_cash_counted ?? 0) - session.theoretical_cash;
      const discrepancyType = this.computeDiscrepancyType(discrepancyAmount);
      const sessionWithComment = session as {
        comment?: string | null;
        notes?: string | null;
      };
      const comment =
        sessionWithComment.comment ??
        sessionWithComment.notes ??
        details?.comment ??
        null;

      return {
        ...session,
        discrepancy_amount: discrepancyAmount,
        discrepancy_type: discrepancyType,
        status: discrepancyType,
        comment,
        notes: comment,
        breakdown: details
          ? {
              date: details.date,
              opening_amount: details.opening_amount ?? session.opening_amount,
              cash_sales: details.cash_sales,
              cash_expenses: details.cash_expenses,
              cash_debt_repayments: details.cash_debt_repayments,
              theoretical_cash: session.theoretical_cash,
            }
          : undefined,
      };
    });

    return {
      data,
      meta: {
        total: totalCount,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.max(1, Math.ceil(totalCount / safeLimit)),
      },
    };
  }
}
