import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ExecutionContext,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ReportStatus } from '@prisma/client';
import { ReportsService } from './reports.service.js';
import { ReportsController } from './reports.controller.js';
import { AdminController } from '../admin/admin.controller.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { TenantGuard } from '../auth/guards/tenant.guard.js';

describe('ReportsService, ReportsController & AdminController', () => {
  let reportsService: ReportsService;
  let adminController: AdminController;

  const mockPrismaService = {
    reports: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController, AdminController],
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    reportsService = module.get<ReportsService>(ReportsService);
    adminController = module.get<AdminController>(AdminController);
    vi.clearAllMocks();
  });

  describe('Accès public sans JWT sur POST /api/v1/public/reports', () => {
    it('devrait autoriser la soumission citoyenne sans en-tete Authorization (@Public)', () => {
      const reflector = new Reflector();
      const jwtGuard = new JwtAuthGuard(reflector);
      const tenantGuard = new TenantGuard(reflector);

      const mockContext = {
        getHandler: () => ({}),
        getClass: () => ReportsController,
        switchToHttp: () => ({
          getRequest: () => ({ headers: {} }),
        }),
      } as unknown as ExecutionContext;

      expect(jwtGuard.canActivate(mockContext)).toBe(true);
      expect(tenantGuard.canActivate(mockContext)).toBe(true);
    });
  });

  describe('createPublicReport (POST /api/v1/public/reports)', () => {
    it('devrait enregistrer un signalement citoyen en base avec le statut EN_ATTENTE par defaut', async () => {
      const now = new Date('2026-11-10T12:00:00Z');
      const createdReport = {
        id: 'rep-uuid-1',
        target_slug: 'boutique-suspecte',
        reason: 'PRIX_ABUSIF',
        reporter_phone: '+2290197112233',
        description: 'Le prix facturé en caisse dépasse le prix affiché en vitrine.',
        evidence_urls: ['https://cdn.vendix.bj/evidence/photo1.jpg'],
        status: ReportStatus.EN_ATTENTE,
        created_at: now,
        updated_at: now,
      };

      mockPrismaService.reports.create.mockResolvedValueOnce(createdReport);

      const result = await reportsService.createPublicReport({
        target_slug: '  Boutique-Suspecte ',
        reason: 'PRIX_ABUSIF',
        reporter_phone: '+2290197112233',
        description: 'Le prix facturé en caisse dépasse le prix affiché en vitrine.',
        evidence_urls: ['https://cdn.vendix.bj/evidence/photo1.jpg'],
      });

      expect(mockPrismaService.reports.create).toHaveBeenCalledWith({
        data: {
          target_slug: 'boutique-suspecte',
          reason: 'PRIX_ABUSIF',
          reporter_phone: '+2290197112233',
          description: 'Le prix facturé en caisse dépasse le prix affiché en vitrine.',
          evidence_urls: ['https://cdn.vendix.bj/evidence/photo1.jpg'],
          status: ReportStatus.EN_ATTENTE,
        },
      });

      expect(result.id).toBe('rep-uuid-1');
      expect(result.status).toBe(ReportStatus.EN_ATTENTE);
      expect(result.target_slug).toBe('boutique-suspecte');
      expect(result.targetSlug).toBe('boutique-suspecte');
    });

    it('devrait lever BadRequestException si target_slug ou reporter_phone est manquant', async () => {
      await expect(
        reportsService.createPublicReport({
          target_slug: '   ',
          reason: 'FRAUDE',
          reporter_phone: '+2290197000000',
          description: 'Signalement test',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        reportsService.createPublicReport({
          target_slug: 'ma-boutique',
          reason: 'FRAUDE',
          reporter_phone: '',
          description: 'Signalement test',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Supervision Admin (GET /admin/reports & PATCH /admin/reports/:id)', () => {
    it('devrait lister les signalements depuis la table reports via AdminController.getReports', async () => {
      const now = new Date();
      mockPrismaService.reports.findMany.mockResolvedValueOnce([
        {
          id: 'rep-1',
          target_slug: 'epicerie-du-port',
          reason: 'PRODUIT_NON_CONFORME',
          reporter_phone: '+2290197001122',
          description: 'Produit périmé reçu.',
          evidence_urls: [],
          status: ReportStatus.EN_ATTENTE,
          created_at: now,
          updated_at: now,
        },
      ]);

      const result = await adminController.getReports(ReportStatus.EN_ATTENTE);

      expect(mockPrismaService.reports.findMany).toHaveBeenCalledWith({
        where: { status: ReportStatus.EN_ATTENTE },
        orderBy: { created_at: 'desc' },
      });
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe('rep-1');
      expect(result[0]?.status).toBe(ReportStatus.EN_ATTENTE);
    });

    it('devrait mettre a jour le statut d un signalement via AdminController.updateReport', async () => {
      const now = new Date();
      const existing = {
        id: 'rep-1',
        target_slug: 'epicerie-du-port',
        reason: 'FRAUDE',
        reporter_phone: '+2290197001122',
        description: 'Signalement vérifié.',
        evidence_urls: [],
        status: ReportStatus.EN_ATTENTE,
        created_at: now,
        updated_at: now,
      };

      mockPrismaService.reports.findUnique.mockResolvedValueOnce(existing);
      mockPrismaService.reports.update.mockResolvedValueOnce({
        ...existing,
        status: ReportStatus.RESOLU,
      });

      const updated = await adminController.updateReport('rep-1', {
        status: ReportStatus.RESOLU,
      });

      expect(mockPrismaService.reports.update).toHaveBeenCalledWith({
        where: { id: 'rep-1' },
        data: { status: ReportStatus.RESOLU },
      });
      expect(updated.status).toBe(ReportStatus.RESOLU);
    });

    it('devrait lever NotFoundException si le signalement a modifier n existe pas', async () => {
      mockPrismaService.reports.findUnique.mockResolvedValueOnce(null);

      await expect(
        adminController.updateReport('rep-inexistant', {
          status: ReportStatus.REJETE,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

