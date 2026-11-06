import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { StockService } from './stock.service.js';
import { CreateStockMovementDto } from './dto/stock.dto.js';
import { CurrentCommerce } from '../auth/decorators/current-commerce.decorator.js';

@Controller(['stock', 'api/v1/stock'])
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get()
  async getStockState(
    @CurrentCommerce('id') commerceId: string,
    @Query('level') level?: string,
    @Query('categoryId') categoryId?: string,
    @Query('search') search?: string,
    @Query('threshold') threshold?: string,
  ) {
    const parsedThreshold = threshold !== undefined ? Number(threshold) : undefined;
    return this.stockService.getStockState(commerceId, {
      level,
      categoryId,
      search,
      threshold: parsedThreshold,
    });
  }

  @Post('movements')
  @HttpCode(HttpStatus.CREATED)
  async recordMovement(
    @CurrentCommerce('id') commerceId: string,
    @Body() dto: CreateStockMovementDto,
  ) {
    return this.stockService.recordMovement(commerceId, dto);
  }

  @Get('movements')
  async getMovementsHistory(
    @CurrentCommerce('id') commerceId: string,
    @Query('productId') productId?: string,
    @Query('product_id') productIdSnake?: string,
    @Query('type') type?: string,
    @Query('motif') motif?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.stockService.getMovementsHistory(commerceId, {
      productId: productId ?? productIdSnake,
      type: type ?? motif,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Get('alerts')
  async getStockAlerts(
    @CurrentCommerce('id') commerceId: string,
    @Query('threshold') threshold?: string,
  ) {
    const parsedThreshold = threshold !== undefined ? Number(threshold) : undefined;
    return this.stockService.getStockAlerts(commerceId, parsedThreshold);
  }

  @Delete('movements/:id')
  async deleteMovement(
    @CurrentCommerce('id') commerceId: string,
    @Param('id') id: string,
  ) {
    return this.stockService.deleteMovement(commerceId, id);
  }
}

