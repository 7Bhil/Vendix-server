import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { SalesService } from './sales.service.js';
import { CreateSaleDto } from './dto/sale.dto.js';
import { CurrentCommerce } from '../auth/decorators/current-commerce.decorator.js';

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Get()
  async findAll(
    @CurrentCommerce('id') commerceId: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    return this.salesService.findAll(commerceId, parsedLimit);
  }

  @Get(':id')
  async findOne(
    @CurrentCommerce('id') commerceId: string,
    @Param('id') id: string,
  ) {
    return this.salesService.findOne(commerceId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentCommerce('id') commerceId: string,
    @Body() dto: CreateSaleDto,
  ) {
    return this.salesService.create(commerceId, dto);
  }
}
