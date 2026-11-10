import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { CashService } from './cash.service.js';
import { CreateCashClosureDto } from './dto/cash.dto.js';
import { CurrentCommerce } from '../auth/decorators/current-commerce.decorator.js';

@Controller(['cash', 'api/v1/cash'])
export class CashController {
  constructor(private readonly cashService: CashService) {}

  @Get('daily-summary')
  async getDailySummary(
    @CurrentCommerce('id') commerceId: string,
    @Query('date') date?: string,
    @Query('openingAmount') openingAmount?: string,
    @Query('opening_amount') openingAmountSnake?: string,
  ) {
    const rawOpening = openingAmount ?? openingAmountSnake;
    const parsedOpening =
      rawOpening !== undefined ? parseInt(rawOpening, 10) : undefined;

    return this.cashService.getDailySummary(commerceId, {
      date,
      openingAmount: parsedOpening,
    });
  }

  @Post('closure')
  @HttpCode(HttpStatus.CREATED)
  async createClosure(
    @CurrentCommerce('id') commerceId: string,
    @Body() dto: CreateCashClosureDto,
  ) {
    return this.cashService.createClosure(commerceId, dto);
  }

  @Get('closures')
  async getClosuresHistory(
    @CurrentCommerce('id') commerceId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.cashService.getClosuresHistory(commerceId, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      startDate,
      endDate,
    });
  }
}

