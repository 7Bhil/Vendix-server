import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ReportStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { ReportsService } from '../reports/reports.service.js';
import { UpdateReportStatusDto } from '../reports/dto/report.dto.js';

@Controller(['admin', 'api/v1/admin'])
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('dashboard')
  async getDashboardStats() {
    const pendingReportsList = await this.reportsService.findAll(
      ReportStatus.EN_ATTENTE,
    );

    return {
      totalMerchants: 42,
      activeMerchants: 38,
      suspendedMerchants: 4,
      totalVolumeFCFA: 18450000,
      pendingReports: pendingReportsList.length,
    };
  }

  @Get('merchants')
  async getMerchants() {
    return [
      {
        id: 'm-001',
        fullName: 'Mme Dossou Bernadette',
        phone: '+22997001122',
        storeName: 'Épicerie du Port',
        slug: 'epicerie-du-port',
        status: 'ACTIF',
      },
    ];
  }

  @Post('merchants/:id/suspend')
  async suspendMerchant(
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return {
      success: true,
      id,
      status: 'SUSPENDU',
      reason: body.reason || 'Non précisé',
    };
  }

  @Get('reports')
  async getReports(@Query('status') status?: ReportStatus) {
    return this.reportsService.findAll(status);
  }

  @Patch('reports/:id')
  async updateReport(
    @Param('id') id: string,
    @Body() body: UpdateReportStatusDto,
  ) {
    return this.reportsService.updateStatus(id, body);
  }
}
