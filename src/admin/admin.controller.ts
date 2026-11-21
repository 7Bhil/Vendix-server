import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { ReportStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller(['admin', 'api/v1/admin'])
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('dashboard')
  async getDashboardStats() {
    const pendingReports = await this.prisma.reports.count({
      where: { status: ReportStatus.EN_ATTENTE },
    });

    return {
      totalMerchants: 42,
      activeMerchants: 38,
      suspendedMerchants: 4,
      totalVolumeFCFA: 18450000,
      pendingReports,
    };
  }

  @Get('merchants')
  async getMerchants() {
    return [
      {
        id: 'm-001',
        fullName: 'Mme Dossou Bernadette',
        phone: '+2290197001122',
        storeName: 'Épicerie du Port',
        slug: 'epicerie-du-port',
        status: 'ACTIF',
      },
    ];
  }

  @Post('merchants/:id/suspend')
  async suspendMerchant(@Param('id') id: string, @Body() body: { reason?: string }) {
    return {
      success: true,
      id,
      status: 'SUSPENDU',
      reason: body.reason || 'Non précisé',
    };
  }

  @Get('reports')
  async getReports(@Query('status') status?: ReportStatus) {
    const reports = await this.prisma.reports.findMany({
      where: status ? { status } : undefined,
      orderBy: { created_at: 'desc' },
    });

    return reports.map((r) => ({
      ...r,
      shop_identifier: r.target_slug,
      shopIdentifier: r.target_slug,
      report_type: r.reason,
      reportType: r.reason,
      reporter_phone: r.reporter_phone,
      reporterPhone: r.reporter_phone,
      targetSlug: r.target_slug,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  @Patch('reports/:id')
  async updateReport(
    @Param('id') id: string,
    @Body() body: { status: ReportStatus },
  ) {
    const existing = await this.prisma.reports.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Signalement introuvable.');
    }

    const updated = await this.prisma.reports.update({
      where: { id },
      data: { status: body.status },
    });

    return {
      success: true,
      ...updated,
    };
  }
}
