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
import { ExpensesService } from './expenses.service.js';
import { CreateExpenseDto } from './dto/expense.dto.js';
import { CurrentCommerce } from '../auth/decorators/current-commerce.decorator.js';

@Controller(['expenses', 'api/v1/expenses'])
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Get()
  async findAll(
    @CurrentCommerce('id') commerceId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('category') category?: string,
    @Query('payment_method') paymentMethod?: string,
    @Query('mode') mode?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.expensesService.findAll(commerceId, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      month: month ? parseInt(month, 10) : undefined,
      year: year ? parseInt(year, 10) : undefined,
      category,
      payment_method: paymentMethod,
      mode,
      startDate,
      endDate,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentCommerce('id') commerceId: string,
    @Body() dto: CreateExpenseDto,
  ) {
    return this.expensesService.create(commerceId, dto);
  }

  @Delete(':id')
  async remove(
    @CurrentCommerce('id') commerceId: string,
    @Param('id') id: string,
  ) {
    return this.expensesService.remove(commerceId, id);
  }
}

