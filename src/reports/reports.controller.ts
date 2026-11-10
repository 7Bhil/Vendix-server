import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator.js';
import { ReportsService } from './reports.service.js';
import { CreateReportDto } from './dto/report.dto.js';

@Public()
@Controller(['api/v1/public/reports', 'public/reports'])
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateReportDto) {
    return this.reportsService.createPublicReport(dto);
  }
}

