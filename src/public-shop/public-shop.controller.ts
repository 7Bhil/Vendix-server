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
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator.js';
import { PublicShopService } from './public-shop.service.js';
import { TrackVisitDto } from './dto/track-visit.dto.js';

@Public()
@Controller(['api/v1/public/shop', 'public/shop'])
export class PublicShopController {
  constructor(private readonly publicShopService: PublicShopService) {}

  @Get(':slug')
  async getShopBySlug(@Param('slug') slug: string) {
    return this.publicShopService.getShopBySlug(slug);
  }

  @Get(':slug/products')
  async getShopProducts(
    @Param('slug') slug: string,
    @Query('categoryId') categoryId?: string,
    @Query('search') search?: string,
  ) {
    return this.publicShopService.getShopProducts(slug, {
      categoryId,
      search,
    });
  }

  @Get(':slug/products/:id')
  async getShopProductById(
    @Param('slug') slug: string,
    @Param('id') id: string,
  ) {
    return this.publicShopService.getShopProductById(slug, id);
  }

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post(':slug/track-visit')
  @HttpCode(HttpStatus.OK)
  async trackVisit(
    @Param('slug') slug: string,
    @Body() dto?: TrackVisitDto,
  ) {
    return this.publicShopService.trackVisit(slug, dto);
  }
}
