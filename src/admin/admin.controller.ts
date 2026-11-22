import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, ReportStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

interface AdminRequest {
  user?: {
    id?: string;
    sub?: string;
    full_name?: string;
    phone?: string;
    email?: string;
  };
  ip?: string;
}

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

  private async recordAuditLog(params: {
    req?: AdminRequest;
    action: string;
    targetType: string;
    targetId: string;
    targetName: string;
    reason: string;
  }) {
    if (typeof this.prisma.admin_audit_logs?.create !== 'function') {
      return;
    }

    const adminId = params.req?.user?.id || params.req?.user?.sub || 'admin-system';
    const adminName =
      params.req?.user?.full_name ||
      params.req?.user?.email ||
      params.req?.user?.phone ||
      'Super-Admin';

    await this.prisma.admin_audit_logs.create({
      data: {
        admin_id: adminId,
        admin_name: adminName,
        action: params.action,
        target_type: params.targetType,
        target_id: params.targetId,
        target_name: params.targetName,
        reason: params.reason,
        ip_address: params.req?.ip || null,
      },
    });
  }

  @Post('merchants/:id/suspend')
  async suspendMerchant(
    @Param('id') id: string,
    @Body() body: { reason?: string; targetName?: string },
    @Req() req?: AdminRequest,
  ) {
    const reason = body.reason || 'Non précisé';

    await this.recordAuditLog({
      req,
      action: 'SUSPEND_MERCHANT',
      targetType: 'SHOP',
      targetId: id,
      targetName: body.targetName || id,
      reason,
    });

    return {
      success: true,
      id,
      status: 'SUSPENDU',
      reason,
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
    @Body() body: { status: ReportStatus; resolutionNote?: string },
    @Req() req?: AdminRequest,
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

    const auditAction =
      body.status === ReportStatus.REJETE
        ? 'REPORT_DISMISSED'
        : 'REPORT_WARNING';

    await this.recordAuditLog({
      req,
      action: auditAction,
      targetType: 'REPORT',
      targetId: id,
      targetName: existing.target_slug || id,
      reason: body.resolutionNote || `Statut mis à jour : ${body.status}`,
    });

    return {
      success: true,
      ...updated,
    };
  }

  @Get('audit-logs')
  async getAuditLogs(
    @Query('action') action?: string,
    @Query('search') search?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const timestampFilter: Prisma.DateTimeFilter = {};

    if (startDate) {
      const parsedStart = new Date(startDate);
      if (Number.isNaN(parsedStart.getTime())) {
        throw new BadRequestException('Le paramètre startDate est invalide.');
      }
      timestampFilter.gte = parsedStart;
    }

    if (endDate) {
      const parsedEnd = new Date(endDate);
      if (Number.isNaN(parsedEnd.getTime())) {
        throw new BadRequestException('Le paramètre endDate est invalide.');
      }
      timestampFilter.lte = parsedEnd;
    }

    const where: Prisma.admin_audit_logsWhereInput = {
      ...(action && action !== 'ALL' ? { action } : {}),
      ...(Object.keys(timestampFilter).length > 0
        ? { timestamp: timestampFilter }
        : {}),
      ...(search?.trim()
        ? {
            OR: [
              { target_name: { contains: search.trim(), mode: 'insensitive' } },
              { admin_name: { contains: search.trim(), mode: 'insensitive' } },
              { reason: { contains: search.trim(), mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const logs = await this.prisma.admin_audit_logs.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: 200,
    });

    return logs.map((log) => ({
      id: log.id,
      timestamp: log.timestamp,
      adminId: log.admin_id,
      adminName: log.admin_name,
      action: log.action,
      targetType: log.target_type,
      targetId: log.target_id,
      targetName: log.target_name,
      reason: log.reason,
      ipAddress: log.ip_address,
    }));
  }
}
