import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReportStatus } from '@prisma/client';

describe('AdminController', () => {
  let adminController: AdminController;

  const mockPrismaService = {
    reports: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    adminController = module.get<AdminController>(AdminController);
    vi.clearAllMocks();
  });

  describe('getDashboardStats', () => {
    it('devrait retourner le compte réel des signalements EN_ATTENTE', async () => {
      mockPrismaService.reports.count.mockResolvedValueOnce(7);

      const stats = await adminController.getDashboardStats();

      expect(mockPrismaService.reports.count).toHaveBeenCalledWith({
        where: { status: ReportStatus.EN_ATTENTE },
      });
      expect(stats.pendingReports).toBe(7);
      expect(stats.totalMerchants).toBe(42);
    });
  });

  describe('getReports', () => {
    it('devrait retourner la liste des signalements enregistrés dans PostgreSQL', async () => {
      const now = new Date();
      const mockReports = [
        {
          id: 'rep-1',
          target_slug: 'comm-uuid-1',
          reason: 'FRAUDE',
          reporter_phone: '+22997001122',
          description: 'Boutique frauduleuse signalée par un client',
          evidence_urls: [],
          status: ReportStatus.EN_ATTENTE,
          created_at: now,
          updated_at: now,
        },
      ];

      mockPrismaService.reports.findMany.mockResolvedValueOnce(mockReports);

      const result = await adminController.getReports();

      expect(mockPrismaService.reports.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { created_at: 'desc' },
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('rep-1');
      expect(result[0].shop_identifier).toBe('comm-uuid-1');
      expect(result[0].report_type).toBe('FRAUDE');
      expect(result[0].reporter_phone).toBe('+22997001122');
      expect(result[0].status).toBe(ReportStatus.EN_ATTENTE);
    });

    it('devrait filtrer les signalements par statut si spécifié', async () => {
      mockPrismaService.reports.findMany.mockResolvedValueOnce([]);

      await adminController.getReports(ReportStatus.EN_COURS);

      expect(mockPrismaService.reports.findMany).toHaveBeenCalledWith({
        where: { status: ReportStatus.EN_COURS },
        orderBy: { created_at: 'desc' },
      });
    });
  });

  describe('updateReport', () => {
    it('devrait mettre à jour le statut d’un signalement existant', async () => {
      const now = new Date();
      mockPrismaService.reports.findUnique.mockResolvedValueOnce({
        id: 'rep-1',
        status: ReportStatus.EN_ATTENTE,
      });
      mockPrismaService.reports.update.mockResolvedValueOnce({
        id: 'rep-1',
        status: ReportStatus.RESOLU,
        updated_at: now,
      });

      const result = await adminController.updateReport('rep-1', {
        status: ReportStatus.RESOLU,
      });

      expect(mockPrismaService.reports.findUnique).toHaveBeenCalledWith({
        where: { id: 'rep-1' },
      });
      expect(mockPrismaService.reports.update).toHaveBeenCalledWith({
        where: { id: 'rep-1' },
        data: { status: ReportStatus.RESOLU },
      });
      expect(result.success).toBe(true);
      expect(result.status).toBe(ReportStatus.RESOLU);
    });

    it('devrait lever NotFoundException si le signalement n’existe pas', async () => {
      mockPrismaService.reports.findUnique.mockResolvedValueOnce(null);

      await expect(
        adminController.updateReport('non-existent-id', {
          status: ReportStatus.RESOLU,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
