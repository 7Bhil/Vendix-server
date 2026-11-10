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
import { SuppliersService } from './suppliers.service.js';
import {
  CreateSupplierDto,
  CreateSupplierPaymentDto,
  UpdateSupplierDto,
} from './dto/supplier.dto.js';
import { CurrentCommerce } from '../auth/decorators/current-commerce.decorator.js';

@Controller(['suppliers', 'api/v1/suppliers'])
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  async findAll(
    @CurrentCommerce('id') commerceId: string,
    @Query('filterMode') filterMode?: 'ALL' | 'CREDITOR' | 'UP_TO_DATE',
    @Query('search') search?: string,
  ) {
    return this.suppliersService.findAll(commerceId, filterMode, search);
  }

  @Get(':id')
  async findOne(
    @CurrentCommerce('id') commerceId: string,
    @Param('id') id: string,
  ) {
    return this.suppliersService.findOne(commerceId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentCommerce('id') commerceId: string,
    @Body() dto: CreateSupplierDto,
  ) {
    return this.suppliersService.create(commerceId, dto);
  }

  @Patch(':id')
  async update(
    @CurrentCommerce('id') commerceId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.suppliersService.update(commerceId, id, dto);
  }

  @Post(':id/payments')
  @HttpCode(HttpStatus.CREATED)
  async recordPayment(
    @CurrentCommerce('id') commerceId: string,
    @Param('id') id: string,
    @Body() dto: CreateSupplierPaymentDto,
  ) {
    return this.suppliersService.recordPayment(commerceId, id, dto);
  }
}

