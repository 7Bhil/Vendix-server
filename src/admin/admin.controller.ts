import { Controller, Get, Post, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { Roles } from '../auth/decorators/roles.decorator.js';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminController {
  @Get('dashboard')
  async getDashboardStats() {
    return {
      totalMerchants: 42,
      activeMerchants: 38,
      suspendedMerchants: 4,
      totalVolumeFCFA: 18450000,
      pendingReports: 3,
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
  async suspendMerchant(@Param('id') id: string, @Body() body: { reason?: string }) {
    return {
      success: true,
      id,
      status: 'SUSPENDU',
      reason: body.reason || 'Non précisé',
    };
  }

  @Get('reports')
  async getReports() {
    return [];
  }

  @Patch('reports/:id')
  async updateReport(@Param('id') id: string, @Body() body: { status: string }) {
    return {
      success: true,
      id,
      status: body.status,
    };
  }
}
