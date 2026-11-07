import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { CustomersService } from './customers.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('CustomersService', () => {
  let customersService: CustomersService;

  const mockPrismaService = {
    customers: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    commerces: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  const commerceId = 'commerce-uuid-1';
  const otherCommerceId = 'commerce-uuid-2';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomersService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    customersService = module.get<CustomersService>(CustomersService);
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(customersService).toBeDefined();
  });

  describe('findAll and findDebtors', () => {
    it('devrait retourner les clients du commerce avec filtrage', async () => {
      const mockList = [
        { id: 'c-1', full_name: 'Moussa Bello', phone: '+22997000001', outstanding_debt: 5000 },
      ];
      mockPrismaService.customers.findMany.mockResolvedValueOnce(mockList);

      const result = await customersService.findAll(commerceId, 'DEBTORS', 'Moussa');

      expect(mockPrismaService.customers.findMany).toHaveBeenCalledWith({
        where: {
          commerce_id: commerceId,
          outstanding_debt: { gt: 0 },
          OR: [
            { full_name: { contains: 'Moussa', mode: 'insensitive' } },
            { phone: { contains: 'Moussa' } },
          ],
        },
        orderBy: { created_at: 'desc' },
        include: {
          _count: {
            select: { sales: true },
          },
        },
      });
      expect(result).toEqual(mockList);
    });

    it('devrait retourner les debiteurs avec le calcul de l anciennete de dette', async () => {
      const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // il y a 5 jours
      const mockDebtors = [
        {
          id: 'deb-1',
          full_name: 'Awa Cisse',
          phone: '+22996000002',
          outstanding_debt: 12000,
          created_at: new Date(),
          sales: [{ created_at: pastDate }],
        },
      ];
      mockPrismaService.customers.findMany.mockResolvedValueOnce(mockDebtors);

      const result = await customersService.findDebtors(commerceId);

      expect(result[0].id).toBe('deb-1');
      expect(result[0].debt_age_days).toBeGreaterThanOrEqual(4);
      expect(result[0].debt_age_days).toBeLessThanOrEqual(6);
    });
  });

  describe('findOne (Tenant Isolation - BOLA)', () => {
    it('devrait retourner le client s il appartient au commerce', async () => {
      const mockCustomer = {
        id: 'cust-1',
        commerce_id: commerceId,
        full_name: 'Amina Sani',
        outstanding_debt: 0,
        sales: [],
        repayments: [],
      };
      mockPrismaService.customers.findFirst.mockResolvedValueOnce(mockCustomer);

      const result = await customersService.findOne(commerceId, 'cust-1');

      expect(mockPrismaService.customers.findFirst).toHaveBeenCalledWith({
        where: { id: 'cust-1', commerce_id: commerceId },
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
      expect(result).toEqual(mockCustomer);
    });

    it('devrait lever NotFoundException si le client appartient a un autre commerce (BOLA)', async () => {
      mockPrismaService.customers.findFirst.mockResolvedValueOnce(null);

      await expect(
        customersService.findOne(otherCommerceId, 'cust-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('create (Unicite du telephone par commerce et solde initial a zero)', () => {
    it('devrait creer un client avec un solde initial de dette a 0', async () => {
      mockPrismaService.customers.findFirst.mockResolvedValueOnce(null);
      const createdCustomer = {
        id: 'cust-new',
        commerce_id: commerceId,
        full_name: 'Bio Chabi',
        phone: '+22995000003',
        outstanding_debt: 0,
      };
      mockPrismaService.customers.create.mockResolvedValueOnce(createdCustomer);

      const result = await customersService.create(commerceId, {
        full_name: 'Bio Chabi',
        phone: '+22995000003',
      });

      expect(mockPrismaService.customers.findFirst).toHaveBeenCalledWith({
        where: {
          commerce_id: commerceId,
          phone: '+22995000003',
        },
      });
      expect(mockPrismaService.customers.create).toHaveBeenCalledWith({
        data: {
          commerce_id: commerceId,
          full_name: 'Bio Chabi',
          phone: '+22995000003',
          outstanding_debt: 0,
        },
      });
      expect(result.outstanding_debt).toBe(0);
    });

    it('devrait lever ConflictException si un client a deja ce telephone dans le meme commerce', async () => {
      mockPrismaService.customers.findFirst.mockResolvedValueOnce({
        id: 'existing-cust',
        commerce_id: commerceId,
        phone: '+22995000003',
      });

      await expect(
        customersService.create(commerceId, {
          full_name: 'Bio Chabi Bis',
          phone: '+22995000003',
        }),
      ).rejects.toThrow(ConflictException);

      expect(mockPrismaService.customers.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('devrait refuser la modification si le nouveau telephone est deja utilise par un autre client', async () => {
      mockPrismaService.customers.findFirst
        .mockResolvedValueOnce({ id: 'c-1', commerce_id: commerceId, phone: '+22990000000' })
        .mockResolvedValueOnce({ id: 'c-2', commerce_id: commerceId, phone: '+22991111111' });

      await expect(
        customersService.update(commerceId, 'c-1', { phone: '+22991111111' }),
      ).rejects.toThrow(ConflictException);
    });

    it('devrait modifier les coordonnees du client avec succes', async () => {
      mockPrismaService.customers.findFirst
        .mockResolvedValueOnce({ id: 'c-1', commerce_id: commerceId, full_name: 'Ancien Nom' })
        .mockResolvedValueOnce(null);
      mockPrismaService.customers.update.mockResolvedValueOnce({
        id: 'c-1',
        full_name: 'Nouveau Nom',
        phone: '+22992222222',
      });

      const result = await customersService.update(commerceId, 'c-1', {
        full_name: 'Nouveau Nom',
        phone: '+22992222222',
      });

      expect(result.full_name).toBe('Nouveau Nom');
    });
  });

  describe('recordRepayment (Imputation FIFO sur les ventes impayees)', () => {
    it('devrait refuser le remboursement si le client n a pas de dette active', async () => {
      mockPrismaService.customers.findFirst.mockResolvedValueOnce({
        id: 'c-1',
        commerce_id: commerceId,
        outstanding_debt: 0,
      });

      await expect(
        customersService.recordRepayment(commerceId, 'c-1', {
          amount: 5000,
          payment_method: PaymentMethod.CASH,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('devrait refuser si le montant rembourse excede la dette totale', async () => {
      mockPrismaService.customers.findFirst.mockResolvedValueOnce({
        id: 'c-1',
        commerce_id: commerceId,
        outstanding_debt: 5000,
      });

      await expect(
        customersService.recordRepayment(commerceId, 'c-1', {
          amount: 6000,
          payment_method: PaymentMethod.CASH,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('devrait enregistrer le remboursement, reduire le solde client et imputer en FIFO sur les ventes impayees', async () => {
      const mockCustomer = {
        id: 'c-debtor',
        commerce_id: commerceId,
        outstanding_debt: 15000,
        sales: [],
        repayments: [],
      };
      mockPrismaService.customers.findFirst.mockResolvedValueOnce(mockCustomer);

      const repaymentDto = {
        amount: 10000,
        payment_method: PaymentMethod.MOMO,
      };

      const unpaidSales = [
        { id: 'sale-oldest', debt_amount: 6000, amount_paid: 2000 },
        { id: 'sale-second', debt_amount: 9000, amount_paid: 1000 },
      ];

      mockPrismaService.$transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
        const tx = {
          customer_repayments: {
            create: vi.fn().mockResolvedValue({
              id: 'rep-1',
              commerce_id: commerceId,
              customer_id: 'c-debtor',
              amount: 10000,
              payment_method: PaymentMethod.MOMO,
            }),
          },
          customers: {
            update: vi.fn().mockResolvedValue({
              id: 'c-debtor',
              outstanding_debt: 5000,
            }),
          },
          sales: {
            findMany: vi.fn().mockResolvedValue(unpaidSales),
            update: vi.fn().mockResolvedValue({}),
          },
        };

        const res = await callback(tx);

        // Verification de l enregistrement du reglement
        expect(tx.customer_repayments.create).toHaveBeenCalledWith({
          data: {
            commerce_id: commerceId,
            customer_id: 'c-debtor',
            amount: 10000,
            payment_method: PaymentMethod.MOMO,
          },
        });

        // Verification de la deduction globale sur la fiche client
        expect(tx.customers.update).toHaveBeenCalledWith({
          where: { id: 'c-debtor' },
          data: {
            outstanding_debt: { decrement: 10000 },
          },
        });

        // Verification de l imputation FIFO :
        // 1ere vente : dette 6000 -> entiérement couverte (reste a imputer = 4000)
        expect(tx.sales.update).toHaveBeenNthCalledWith(1, {
          where: { id: 'sale-oldest' },
          data: {
            debt_amount: 0,
            amount_paid: 8000,
          },
        });

        // 2eme vente : dette 9000 -> deduction de 4000 (nouvelle dette = 5000)
        expect(tx.sales.update).toHaveBeenNthCalledWith(2, {
          where: { id: 'sale-second' },
          data: {
            debt_amount: 5000,
            amount_paid: 5000,
          },
        });

        return res;
      });

      const result = await customersService.recordRepayment(commerceId, 'c-debtor', repaymentDto);

      expect(result.repayment.amount).toBe(10000);
      expect(result.customer.outstanding_debt).toBe(5000);
    });
  });

  describe('getWhatsAppReminder (Formatage du lien wa.me)', () => {
    it('devrait refuser la relance si le client n a aucune dette', async () => {
      mockPrismaService.customers.findFirst.mockResolvedValueOnce({
        id: 'c-1',
        commerce_id: commerceId,
        outstanding_debt: 0,
      });
      mockPrismaService.commerces.findUnique.mockResolvedValueOnce({
        id: commerceId,
        name: 'Épicerie Centrale',
      });

      await expect(
        customersService.getWhatsAppReminder(commerceId, 'c-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('devrait generer un lien wa.me correct avec numero nettoye et message encode', async () => {
      mockPrismaService.customers.findFirst.mockResolvedValueOnce({
        id: 'c-debtor',
        commerce_id: commerceId,
        full_name: 'Kofi Mensah',
        phone: '+229 97-00-11-22',
        outstanding_debt: 25000,
      });
      mockPrismaService.commerces.findUnique.mockResolvedValueOnce({
        id: commerceId,
        name: 'Boutique Le Progrès',
      });

      const result = await customersService.getWhatsAppReminder(commerceId, 'c-debtor');

      expect(result.customer_id).toBe('c-debtor');
      expect(result.customer_name).toBe('Kofi Mensah');
      expect(result.amount_due).toBe(25000);
      expect(result.whatsapp_url).toContain('https://wa.me/22997001122?text=');
      expect(decodeURIComponent(result.whatsapp_url)).toContain('Kofi Mensah');
      expect(decodeURIComponent(result.whatsapp_url)).toContain('Boutique Le Progrès');
      expect(decodeURIComponent(result.whatsapp_url)).toContain('FCFA');
    });
  });
});
