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
import { ProductsService } from './products.service.js';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto.js';
import { CurrentCommerce } from '../auth/decorators/current-commerce.decorator.js';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  async findAll(
    @CurrentCommerce('id') commerceId: string,
    @Query('categoryId') categoryId?: string,
    @Query('search') search?: string,
  ) {
    return this.productsService.findAll(commerceId, { categoryId, search });
  }

  @Get(':id')
  async findOne(
    @CurrentCommerce('id') commerceId: string,
    @Param('id') id: string,
  ) {
    return this.productsService.findOne(commerceId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentCommerce('id') commerceId: string,
    @Body() dto: CreateProductDto,
  ) {
    return this.productsService.create(commerceId, dto);
  }

  @Patch(':id')
  async update(
    @CurrentCommerce('id') commerceId: string,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.update(commerceId, id, dto);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  async archive(
    @CurrentCommerce('id') commerceId: string,
    @Param('id') id: string,
  ) {
    return this.productsService.archive(commerceId, id);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  async restore(
    @CurrentCommerce('id') commerceId: string,
    @Param('id') id: string,
  ) {
    return this.productsService.restore(commerceId, id);
  }
}
