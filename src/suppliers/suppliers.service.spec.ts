import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { SuppliersService } from './suppliers.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('SuppliersService', () => {
  let suppliersService: SuppliersService;

  const mockPrismaService = {
    suppliers: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  const commerceId = 'commerce-uuid-1';
  const otherCommerceId = 'commerce-uuid-2';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuppliersService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    suppliersService = module.get<SuppliersService>(SuppliersService);
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(suppliersService).toBeDefined();
  });

  describe('findAll', () => {
    it('devrait retourner la liste des fournisseurs avec contact WhatsApp et amountDue', async () => {
      const mockList = [
        {
          id: 'sup-1',
          commerce_id: commerceId,
          name: 'Grossiste Dantokpa',
          phone: '+22997112233',
          outstanding_debt: 45000,
          created_at: new Date(),
          updated_at: new Date(),
          _count: { purchases: 3 },
        },
      ];
      mockPrismaService.suppliers.findMany.mockResolvedValueOnce(mockList);

      const result = await suppliersService.findAll(commerceId, 'CREDITOR', 'Dantokpa');

      expect(mockPrismaService.suppliers.findMany).toHaveBeenCalledWith({
        where: {
          commerce_id: commerceId,
          outstanding_debt: { gt: 0 },
          OR: [
            { name: { contains: 'Dantokpa', mode: 'insensitive' } },
            { phone: { contains: 'Dantokpa' } },
          ],
        },
        orderBy: { created_at: 'desc' },
        include: {
          _count: {
            select: { purchases: true },
          },
        },
      });
      expect(result[0].amountDue).toBe(45000);
      expect(result[0].whatsappContact).toBe('https://wa.me/22997112233');
    });
  });

  describe('findOne (Isolation BOLA)', () => {
    it('devrait retourner le fournisseur s il appartient au commerce', async () => {
      const mockSupplier = {
        id: 'sup-1',
        commerce_id: commerceId,
        name: 'Grossiste Dantokpa',
        phone: '+22997112233',
        outstanding_debt: 15000,
        purchases: [],
        payments: [],
      };
      mockPrismaService.suppliers.findFirst.mockResolvedValueOnce(mockSupplier);

      const result = await suppliersService.findOne(commerceId, 'sup-1');

      expect(result.id).toBe('sup-1');
      expect(result.amountDue).toBe(15000);
    });

    it('devrait lever NotFoundException si le fournisseur appartient a un autre commerce (BOLA)', async () => {
      mockPrismaService.suppliers.findFirst.mockResolvedValueOnce(null);

      await expect(
        suppliersService.findOne(otherCommerceId, 'sup-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('devrait creer une fiche fournisseur avec dette initiale a 0', async () => {
      mockPrismaService.suppliers.findFirst.mockResolvedValueOnce(null);
      const created = {
        id: 'sup-new',
        commerce_id: commerceId,
        name: 'Ets Sodeco',
        phone: '+22995001122',
        outstanding_debt: 0,
      };
      mockPrismaService.suppliers.create.mockResolvedValueOnce(created);

      const result = await suppliersService.create(commerceId, {
        name: 'Ets Sodeco',
        phone: '+22995001122',
      });

      expect(mockPrismaService.suppliers.create).toHaveBeenCalledWith({
        data: {
          commerce_id: commerceId,
          name: 'Ets Sodeco',
          phone: '+22995001122',
          outstanding_debt: 0,
        },
      });
      expect(result.amountDue).toBe(0);
      expect(result.whatsappContact).toBe('https://wa.me/22995001122');
    });

    it('devrait lever ConflictException si le numero existe deja dans la boutique', async () => {
      mockPrismaService.suppliers.findFirst.mockResolvedValueOnce({
        id: 'sup-existing',
        commerce_id: commerceId,
        phone: '+22995001122',
      });

      await expect(
        suppliersService.create(commerceId, {
          name: 'Autre Fournisseur',
          phone: '+22995001122',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('recordPayment (Versement d acompte ou reglement de facture avec imputation FIFO)', () => {
    it('devrait refuser un versement si le fournisseur n a aucune dette active', async () => {
      mockPrismaService.suppliers.findFirst.mockResolvedValueOnce({
        id: 'sup-1',
        commerce_id: commerceId,
        name: 'Fournisseur Zero Dette',
        phone: '+22990000000',
        outstanding_debt: 0,
      });

      await expect(
        suppliersService.recordPayment(commerceId, 'sup-1', {
          amount: 5000,
          payment_method: PaymentMethod.CASH,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('devrait refuser un versement superieur a la dette fournisseur', async () => {
      mockPrismaService.suppliers.findFirst.mockResolvedValueOnce({
        id: 'sup-1',
        commerce_id: commerceId,
        name: 'Fournisseur Dette',
        phone: '+22990000000',
        outstanding_debt: 10000,
      });

      await expect(
        suppliersService.recordPayment(commerceId, 'sup-1', {
          amount: 15000,
          payment_method: PaymentMethod.CASH,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('devrait mettre a jour le compte de dette fournisseur lors d un paiement partiel et imputer en FIFO', async () => {
      mockPrismaService.suppliers.findFirst.mockResolvedValueOnce({
        id: 'sup-debt',
        commerce_id: commerceId,
        name: 'Fournisseur Riz',
        phone: '+22997111111',
        outstanding_debt: 50000,
      });

      const unpaidPurchases = [
        { id: 'pur-1', debt_amount: 20000, amount_paid: 10000 },
        { id: 'pur-2', debt_amount: 30000, amount_paid: 0 },
      ];

      interface MockTx {
        supplier_payments: { create: ReturnType<typeof vi.fn> };
        suppliers: { update: ReturnType<typeof vi.fn> };
        purchases: {
          findMany: ReturnType<typeof vi.fn>;
          update: ReturnType<typeof vi.fn>;
        };
      }

      mockPrismaService.$transaction.mockImplementation(
        async (callback: (tx: MockTx) => Promise<unknown>) => {
          const tx: MockTx = {
            supplier_payments: {
              create: vi.fn().mockResolvedValue({
                id: 'pay-1',
                commerce_id: commerceId,
                supplier_id: 'sup-debt',
                amount: 25000,
                payment_method: PaymentMethod.MOMO,
              }),
            },
            suppliers: {
              update: vi.fn().mockResolvedValue({
                id: 'sup-debt',
                commerce_id: commerceId,
                name: 'Fournisseur Riz',
                phone: '+22997111111',
                outstanding_debt: 25000,
              }),
            },
            purchases: {
              findMany: vi.fn().mockResolvedValue(unpaidPurchases),
              update: vi.fn().mockResolvedValue({}),
            },
          };

          const res = await callback(tx);

          expect(tx.suppliers.update).toHaveBeenCalledWith({
            where: { id: 'sup-debt' },
            data: {
              outstanding_debt: { decrement: 25000 },
            },
          });

          // 1ere commande (dette 20000) -> soldée à 0
          expect(tx.purchases.update).toHaveBeenNthCalledWith(1, {
            where: { id: 'pur-1' },
            data: {
              debt_amount: 0,
              amount_paid: 30000,
            },
          });

          // 2eme commande (dette 30000) -> réduite de 5000 (nouvelle dette 25000)
          expect(tx.purchases.update).toHaveBeenNthCalledWith(2, {
            where: { id: 'pur-2' },
            data: {
              debt_amount: 25000,
              amount_paid: 5000,
            },
          });

          return res;
        },
      );

      const result = await suppliersService.recordPayment(commerceId, 'sup-debt', {
        amount: 25000,
        payment_method: PaymentMethod.MOMO,
        notes: 'Règlement partiel facture riz',
      });

      expect(result.payment.amount).toBe(25000);
      expect(result.supplier.outstanding_debt).toBe(25000);
      expect(result.supplier.amountDue).toBe(25000);
    });
  });
});

