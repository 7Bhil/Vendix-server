import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller.js';
import { ReportsModule } from '../reports/reports.module.js';

@Module({
  imports: [ReportsModule],
  controllers: [AdminController],
})
export class AdminModule {}
