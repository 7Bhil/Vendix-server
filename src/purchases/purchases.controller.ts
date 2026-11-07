import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PurchasesService } from './purchases.service.js';
import { CreatePurchaseDto } from './dto/purchase.dto.js';
import { CurrentCommerce } from '../auth/decorators/current-commerce.decorator.js';

@Controller(['purchases', 'api/v1/purchases'])
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Get()
  async findAll(
    @CurrentCommerce('id') commerceId: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    return this.purchasesService.findAll(commerceId, parsedLimit);
  }

  @Get(':id')
  async findOne(
    @CurrentCommerce('id') commerceId: string,
    @Param('id') id: string,
  ) {
    return this.purchasesService.findOne(commerceId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentCommerce('id') commerceId: string,
    @Body() dto: CreatePurchaseDto,
  ) {
    return this.purchasesService.create(commerceId, dto);
  }

  @Patch(':id/receive')
  async receiveOrder(
    @CurrentCommerce('id') commerceId: string,
    @Param('id') id: string,
  ) {
    return this.purchasesService.receiveOrder(commerceId, id);
  }
}

