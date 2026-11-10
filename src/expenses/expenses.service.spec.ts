import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ExpensesService } from './expenses.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ExpenseCategory, ExpensePaymentMethod } from './dto/expense.dto.js';

describe('ExpensesService', () => {
  let expensesService: ExpensesService;

  const mockPrismaService = {
    expenses: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    audit_logs: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    sync_operations: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  const commerceId = 'commerce-uuid-1';
  const otherCommerceId = 'commerce-uuid-2';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpensesService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    expensesService = module.get<ExpensesService>(ExpensesService);
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(expensesService).toBeDefined();
  });

  describe('GET /api/v1/expenses - findAll (Liste paginée du mois en cours avec cumul total)', () => {
    it('devrait retourner la liste paginée des dépenses du mois en cours avec le cumul total en FCFA', async () => {
      const now = new Date();
      const mockExpenses = [
        {
          id: 'exp-1',
          commerce_id: commerceId,
          category: ExpenseCategory.RENT,
          amount: 50000,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'exp-2',
          commerce_id: commerceId,
          category: ExpenseCategory.TRANSPORT,
          amount: 3500,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'exp-3',
          commerce_id: commerceId,
          category: ExpenseCategory.ELECTRICITY,
          amount: 12000,
          created_at: now,
          updated_at: now,
        },
      ];

      const mockLogs = [
        {
          id: 'exp-1',
          details: {
            category: ExpenseCategory.RENT,
            payment_method: ExpensePaymentMethod.MOMO,
            motif: 'Loyer mensuel boutique',
          },
        },
        {
          id: 'exp-2',
          details: {
            category: ExpenseCategory.TRANSPORT,
            payment_method: ExpensePaymentMethod.CASH,
            motif: 'Tricycle livraison sacs de riz',
          },
        },
        {
          id: 'exp-3',
          details: {
            category: ExpenseCategory.ELECTRICITY,
            payment_method: ExpensePaymentMethod.CASH,
            motif: 'Recharge compteur SBEE',
          },
        },
      ];

      mockPrismaService.expenses.findMany.mockResolvedValueOnce(mockExpenses);
      mockPrismaService.audit_logs.findMany.mockResolvedValueOnce(mockLogs);

      const result = await expensesService.findAll(commerceId, { page: 1, limit: 2 });

      expect(result.data).toHaveLength(2);
      expect(result.total_amount).toBe(65500);
      expect(result.cumulative_total).toBe(65500);
      expect(result.summary.total_amount).toBe(65500);
      expect(result.summary.cash_total).toBe(15500);
      expect(result.summary.momo_total).toBe(50000);
      expect(result.summary.by_category[ExpenseCategory.RENT]).toBe(50000);
      expect(result.summary.by_category[ExpenseCategory.TRANSPORT]).toBe(3500);
      expect(result.summary.by_category[ExpenseCategory.ELECTRICITY]).toBe(12000);
      expect(result.meta.total).toBe(3);
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(2);
      expect(result.meta.totalPages).toBe(2);
      expect(result.data[0].motif).toBe('Loyer mensuel boutique');
      expect(result.data[0].payment_method).toBe(ExpensePaymentMethod.MOMO);
    });

    it('devrait filtrer les dépenses par mode de paiement (CASH ou MOMO)', async () => {
      const now = new Date();
      mockPrismaService.expenses.findMany.mockResolvedValueOnce([
        {
          id: 'exp-1',
          commerce_id: commerceId,
          category: ExpenseCategory.PACKAGING,
          amount: 2000,
          created_at: now,
          updated_at: now,
        },
        {
          id: 'exp-2',
          commerce_id: commerceId,
          category: ExpenseCategory.OTHER,
          amount: 5000,
          created_at: now,
          updated_at: now,
        },
      ]);
      mockPrismaService.audit_logs.findMany.mockResolvedValueOnce([
        {
          id: 'exp-1',
          details: { payment_method: ExpensePaymentMethod.CASH, motif: 'Sachets plastiques' },
        },
        {
          id: 'exp-2',
          details: { payment_method: ExpensePaymentMethod.MOMO, motif: 'Frais divers' },
        },
      ]);

      const result = await expensesService.findAll(commerceId, {
        mode: ExpensePaymentMethod.CASH,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('exp-1');
      expect(result.total_amount).toBe(2000);
    });
  });

  describe('POST /api/v1/expenses - create (Enregistrement d une dépense en FCFA entier)', () => {
    it('devrait enregistrer une dépense valide avec montant entier FCFA, catégorie, mode CASH et motif', async () => {
      const now = new Date();
      const createdRow = {
        id: 'exp-new-1',
        commerce_id: commerceId,
        category: ExpenseCategory.TRANSPORT,
        amount: 2500,
        created_at: now,
        updated_at: now,
      };

      mockPrismaService.$transaction.mockImplementation(
        async (cb: (tx: typeof mockPrismaService) => Promise<unknown>) => cb(mockPrismaService),
      );
      mockPrismaService.expenses.create.mockResolvedValueOnce(createdRow);
      mockPrismaService.audit_logs.create.mockResolvedValueOnce({});

      const result = await expensesService.create(commerceId, {
        amount: 2500,
        category: ExpenseCategory.TRANSPORT,
        payment_method: ExpensePaymentMethod.CASH,
        motif: 'Transport marchandises marché Dantokpa',
      });

      expect(mockPrismaService.expenses.create).toHaveBeenCalledWith({
        data: {
          id: undefined,
          commerce_id: commerceId,
          category: ExpenseCategory.TRANSPORT,
          amount: 2500,
        },
      });
      expect(mockPrismaService.audit_logs.create).toHaveBeenCalledWith({
        data: {
          id: 'exp-new-1',
          event_type: 'EXPENSE_CREATE',
          details: {
            commerce_id: commerceId,
            expense_id: 'exp-new-1',
            category: ExpenseCategory.TRANSPORT,
            payment_method: ExpensePaymentMethod.CASH,
            mode: ExpensePaymentMethod.CASH,
            motif: 'Transport marchandises marché Dantokpa',
          },
        },
      });
      expect(result.amount).toBe(2500);
      expect(result.category).toBe(ExpenseCategory.TRANSPORT);
      expect(result.payment_method).toBe(ExpensePaymentMethod.CASH);
      expect(result.mode).toBe(ExpensePaymentMethod.CASH);
      expect(result.motif).toBe('Transport marchandises marché Dantokpa');
    });

    it('devrait refuser un montant décimal (FCFA sans centimes) ou négatif', async () => {
      await expect(
        expensesService.create(commerceId, {
          amount: 1500.5,
          category: ExpenseCategory.OTHER,
          payment_method: ExpensePaymentMethod.CASH,
          motif: 'Montant avec centimes',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        expensesService.create(commerceId, {
          amount: 0,
          category: ExpenseCategory.OTHER,
          payment_method: ExpensePaymentMethod.CASH,
          motif: 'Montant nul',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('devrait refuser une dépense sans motif', async () => {
      await expect(
        expensesService.create(commerceId, {
          amount: 1000,
          category: ExpenseCategory.PACKAGING,
          payment_method: ExpensePaymentMethod.MOMO,
          motif: '   ',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('DELETE /api/v1/expenses/:id - remove (Annulation d une dépense et isolation BOLA)', () => {
    it('devrait annuler une dépense existante du commerce', async () => {
      mockPrismaService.expenses.findFirst.mockResolvedValueOnce({
        id: 'exp-del-1',
        commerce_id: commerceId,
        category: ExpenseCategory.PACKAGING,
        amount: 1500,
      });
      mockPrismaService.expenses.delete.mockResolvedValueOnce({ id: 'exp-del-1' });
      mockPrismaService.audit_logs.deleteMany.mockResolvedValueOnce({ count: 1 });

      const result = await expensesService.remove(commerceId, 'exp-del-1');

      expect(mockPrismaService.expenses.findFirst).toHaveBeenCalledWith({
        where: { id: 'exp-del-1', commerce_id: commerceId },
      });
      expect(mockPrismaService.expenses.delete).toHaveBeenCalledWith({
        where: { id: 'exp-del-1' },
      });
      expect(result.deleted).toBe(true);
      expect(result.id).toBe('exp-del-1');
    });

    it('devrait lever NotFoundException si la dépense appartient à un autre commerce (isolation BOLA)', async () => {
      mockPrismaService.expenses.findFirst.mockResolvedValueOnce(null);

      await expect(
        expensesService.remove(otherCommerceId, 'exp-del-1'),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrismaService.expenses.delete).not.toHaveBeenCalled();
    });
  });
});

