import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PaymentMethod, SaleStatus } from '@prisma/client';
import { CashService } from './cash.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CashDiscrepancyType } from './dto/cash.dto.js';
import { ExpenseCategory, ExpensePaymentMethod } from '../expenses/dto/expense.dto.js';

describe('CashService', () => {
  let cashService: CashService;

  const mockPrismaService = {
    sales: {
      findMany: vi.fn(),
    },
    expenses: {
      findMany: vi.fn(),
    },
    customer_repayments: {
      findMany: vi.fn(),
    },
    cash_sessions: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    audit_logs: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    sync_operations: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  const commerceId = 'commerce-uuid-1';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    cashService = module.get<CashService>(CashService);
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(cashService).toBeDefined();
  });

  describe('GET /api/v1/cash/daily-summary - Calcul déterministe du théorique attendu', () => {
    it('devrait calculer exactement : Ventes espèces - Dépenses espèces + Règlements dettes espèces', async () => {
      // Ventes du jour : 2 ventes CASH (20 000 + 15 000 = 35 000) et 1 vente MOMO (10 000 ignorée du tiroir espèces)
      mockPrismaService.sales.findMany.mockResolvedValueOnce([
        {
          id: 'sale-1',
          commerce_id: commerceId,
          total_amount: 20000,
          amount_paid: 20000,
          payment_method: PaymentMethod.CASH,
          status: SaleStatus.COMPLETED,
        },
        {
          id: 'sale-2',
          commerce_id: commerceId,
          total_amount: 15000,
          amount_paid: 15000,
          payment_method: PaymentMethod.CASH,
          status: SaleStatus.COMPLETED,
        },
        {
          id: 'sale-3',
          commerce_id: commerceId,
          total_amount: 10000,
          amount_paid: 10000,
          payment_method: PaymentMethod.MOMO,
          status: SaleStatus.COMPLETED,
        },
      ]);

      // Dépenses du jour : 1 dépense CASH (4 500) et 1 dépense MOMO (25 000 ignorée du tiroir espèces)
      mockPrismaService.expenses.findMany.mockResolvedValueOnce([
        {
          id: 'exp-cash-1',
          commerce_id: commerceId,
          category: ExpenseCategory.TRANSPORT,
          amount: 4500,
        },
        {
          id: 'exp-momo-1',
          commerce_id: commerceId,
          category: ExpenseCategory.RENT,
          amount: 25000,
        },
      ]);

      mockPrismaService.audit_logs.findMany.mockResolvedValueOnce([
        {
          id: 'exp-cash-1',
          details: { payment_method: ExpensePaymentMethod.CASH, motif: 'Livraison' },
        },
        {
          id: 'exp-momo-1',
          details: { payment_method: ExpensePaymentMethod.MOMO, motif: 'Avance loyer' },
        },
      ]);

      // Règlements dettes clients du jour : 1 règlement CASH (8 000) et 1 règlement MOMO (5 000 ignoré du tiroir espèces)
      mockPrismaService.customer_repayments.findMany.mockResolvedValueOnce([
        {
          id: 'rep-cash-1',
          commerce_id: commerceId,
          amount: 8000,
          payment_method: PaymentMethod.CASH,
        },
        {
          id: 'rep-momo-1',
          commerce_id: commerceId,
          amount: 5000,
          payment_method: PaymentMethod.MOMO,
        },
      ]);

      mockPrismaService.cash_sessions.findFirst.mockResolvedValueOnce(null);

      const summary = await cashService.getDailySummary(commerceId);

      // Théorique attendu = 35 000 (Ventes espèces) - 4 500 (Dépenses espèces) + 8 000 (Règlements dettes espèces) = 38 500 FCFA
      expect(summary.cash_sales).toBe(35000);
      expect(summary.cash_expenses).toBe(4500);
      expect(summary.cash_debt_repayments).toBe(8000);
      expect(summary.theoretical_cash).toBe(38500);
      expect(summary.non_cash_summary.momo_sales).toBe(10000);
      expect(summary.non_cash_summary.momo_expenses).toBe(25000);
      expect(summary.non_cash_summary.momo_repayments).toBe(5000);
    });
  });

  describe('POST /api/v1/cash/closure - Clôture de caisse, calcul d écart et commentaire obligatoire', () => {
    const setupDailyMocks = () => {
      // Théorique attendu = 30 000 (ventes CASH) - 5 000 (dépenses CASH) + 5 000 (règlements CASH) = 30 000 FCFA
      mockPrismaService.sales.findMany.mockResolvedValueOnce([
        {
          id: 's-1',
          commerce_id: commerceId,
          total_amount: 30000,
          amount_paid: 30000,
          payment_method: PaymentMethod.CASH,
          status: SaleStatus.COMPLETED,
        },
      ]);
      mockPrismaService.expenses.findMany.mockResolvedValueOnce([
        {
          id: 'e-1',
          commerce_id: commerceId,
          category: ExpenseCategory.PACKAGING,
          amount: 5000,
        },
      ]);
      mockPrismaService.audit_logs.findMany.mockResolvedValueOnce([
        {
          id: 'e-1',
          details: { payment_method: ExpensePaymentMethod.CASH },
        },
      ]);
      mockPrismaService.customer_repayments.findMany.mockResolvedValueOnce([
        {
          id: 'r-1',
          commerce_id: commerceId,
          amount: 5000,
          payment_method: PaymentMethod.CASH,
        },
      ]);
      mockPrismaService.cash_sessions.findFirst.mockResolvedValueOnce(null);
    };

    it('devrait enregistrer une clôture équilibrée (écart = 0) sans exiger de commentaire', async () => {
      setupDailyMocks();
      const now = new Date();
      mockPrismaService.$transaction.mockImplementation(
        async (cb: (tx: typeof mockPrismaService) => Promise<unknown>) => cb(mockPrismaService),
      );
      mockPrismaService.cash_sessions.create.mockResolvedValueOnce({
        id: 'closure-balanced',
        commerce_id: commerceId,
        opening_amount: 0,
        theoretical_cash: 30000,
        actual_cash_counted: 30000,
        discrepancy_amount: 0,
        closed_at: now,
        created_at: now,
        updated_at: now,
      });
      mockPrismaService.audit_logs.create.mockResolvedValueOnce({});

      const result = await cashService.createClosure(commerceId, {
        actual_cash_counted: 30000,
      });

      expect(result.theoretical_cash).toBe(30000);
      expect(result.actual_cash_counted).toBe(30000);
      expect(result.discrepancy_amount).toBe(0);
      expect(result.discrepancy_type).toBe(CashDiscrepancyType.BALANCED);
    });

    it('devrait rejeter une clôture avec écart (missing ou surplus) si le commentaire explicatif est absent', async () => {
      setupDailyMocks();

      await expect(
        cashService.createClosure(commerceId, {
          actual_cash_counted: 28000, // Manquant de 2000 FCFA sans commentaire
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrismaService.cash_sessions.create).not.toHaveBeenCalled();
    });

    it('devrait calculer un écart "missing" (< 0) et enregistrer la clôture lorsque le commentaire est fourni', async () => {
      setupDailyMocks();
      const now = new Date();
      mockPrismaService.$transaction.mockImplementation(
        async (cb: (tx: typeof mockPrismaService) => Promise<unknown>) => cb(mockPrismaService),
      );
      mockPrismaService.cash_sessions.create.mockResolvedValueOnce({
        id: 'closure-missing',
        commerce_id: commerceId,
        opening_amount: 0,
        theoretical_cash: 30000,
        actual_cash_counted: 27500,
        discrepancy_amount: -2500,
        closed_at: now,
        created_at: now,
        updated_at: now,
      });
      mockPrismaService.audit_logs.create.mockResolvedValueOnce({});

      const result = await cashService.createClosure(commerceId, {
        actual_cash_counted: 27500,
        comment: 'Erreur de rendu monnaie sur une coupure de 10 000 FCFA',
      });

      expect(result.discrepancy_amount).toBe(-2500);
      expect(result.discrepancy_type).toBe('missing');
      expect(result.status).toBe('missing');
      expect(result.comment).toBe('Erreur de rendu monnaie sur une coupure de 10 000 FCFA');
    });

    it('devrait calculer un écart "surplus" (> 0) et enregistrer la clôture lorsque le commentaire est fourni', async () => {
      setupDailyMocks();
      const now = new Date();
      mockPrismaService.$transaction.mockImplementation(
        async (cb: (tx: typeof mockPrismaService) => Promise<unknown>) => cb(mockPrismaService),
      );
      mockPrismaService.cash_sessions.create.mockResolvedValueOnce({
        id: 'closure-surplus',
        commerce_id: commerceId,
        opening_amount: 0,
        theoretical_cash: 30000,
        actual_cash_counted: 31500,
        discrepancy_amount: 1500,
        closed_at: now,
        created_at: now,
        updated_at: now,
      });
      mockPrismaService.audit_logs.create.mockResolvedValueOnce({});

      const result = await cashService.createClosure(commerceId, {
        actual_cash_counted: 31500,
        comment: 'Monnaie laissée par un client pressé',
      });

      expect(result.discrepancy_amount).toBe(1500);
      expect(result.discrepancy_type).toBe('surplus');
      expect(result.status).toBe('surplus');
      expect(result.comment).toBe('Monnaie laissée par un client pressé');
    });
  });

  describe('GET /api/v1/cash/closures - Historique des clôtures passées', () => {
    it('devrait retourner l historique paginé des clôtures passées avec statut et commentaire', async () => {
      const closedDate = new Date();
      mockPrismaService.cash_sessions.findMany.mockResolvedValueOnce([
        {
          id: 'sess-1',
          commerce_id: commerceId,
          opening_amount: 0,
          theoretical_cash: 40000,
          actual_cash_counted: 39000,
          discrepancy_amount: -1000,
          closed_at: closedDate,
          created_at: closedDate,
          updated_at: closedDate,
        },
      ]);
      mockPrismaService.cash_sessions.count.mockResolvedValueOnce(1);
      mockPrismaService.audit_logs.findMany.mockResolvedValueOnce([
        {
          id: 'sess-1',
          details: {
            comment: 'Manquant constaté au comptage du soir',
            cash_sales: 45000,
            cash_expenses: 5000,
            cash_debt_repayments: 0,
          },
        },
      ]);

      const history = await cashService.getClosuresHistory(commerceId, {
        page: 1,
        limit: 10,
      });

      expect(history.data).toHaveLength(1);
      expect(history.data[0].id).toBe('sess-1');
      expect(history.data[0].discrepancy_type).toBe('missing');
      expect(history.data[0].comment).toBe('Manquant constaté au comptage du soir');
      expect(history.meta.total).toBe(1);
    });
  });
});

