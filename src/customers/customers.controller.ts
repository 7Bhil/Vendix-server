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
import { CustomersService } from './customers.service.js';
import { CreateCustomerDto, CreateRepaymentDto, UpdateCustomerDto } from './dto/customer.dto.js';
import { CurrentCommerce } from '../auth/decorators/current-commerce.decorator.js';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  async findAll(
    @CurrentCommerce('id') commerceId: string,
    @Query('filterMode') filterMode?: 'ALL' | 'DEBTORS' | 'UP_TO_DATE',
    @Query('search') search?: string,
  ) {
    return this.customersService.findAll(commerceId, filterMode, search);
  }

  @Get('debts')
  async findDebtors(@CurrentCommerce('id') commerceId: string) {
    return this.customersService.findDebtors(commerceId);
  }

  @Get(':id')
  async findOne(
    @CurrentCommerce('id') commerceId: string,
    @Param('id') id: string,
  ) {
    return this.customersService.findOne(commerceId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentCommerce('id') commerceId: string,
    @Body() dto: CreateCustomerDto,
  ) {
    return this.customersService.create(commerceId, dto);
  }

  @Patch(':id')
  async update(
    @CurrentCommerce('id') commerceId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.update(commerceId, id, dto);
  }

  @Post(':id/repayments')
  @HttpCode(HttpStatus.CREATED)
  async recordRepayment(
    @CurrentCommerce('id') commerceId: string,
    @Param('id') id: string,
    @Body() dto: CreateRepaymentDto,
  ) {
    return this.customersService.recordRepayment(commerceId, id, dto);
  }

  @Get(':id/whatsapp-reminder')
  async getWhatsAppReminder(
    @CurrentCommerce('id') commerceId: string,
    @Param('id') id: string,
  ) {
    return this.customersService.getWhatsAppReminder(commerceId, id);
  }
}
