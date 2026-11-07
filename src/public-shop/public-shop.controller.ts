import {
  BadRequestException,
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
import { GetShopProductsDto } from './dto/get-shop-products.dto.js';

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validateSlug(slug: string): string {
  const normalized = (slug || '').trim().toLowerCase();
  if (!normalized || !SLUG_REGEX.test(normalized)) {
    throw new BadRequestException('Le format du slug de boutique est invalide.');
  }
  return normalized;
}

@Public()
@Controller(['api/v1/public/shop', 'public/shop'])
export class PublicShopController {
  constructor(private readonly publicShopService: PublicShopService) {}

  @Get(':slug')
  async getShopBySlug(@Param('slug') slug: string) {
    return this.publicShopService.getShopBySlug(validateSlug(slug));
  }

  @Get(':slug/products')
  async getShopProducts(
    @Param('slug') slug: string,
    @Query() query?: GetShopProductsDto,
  ) {
    return this.publicShopService.getShopProducts(validateSlug(slug), query);
  }

  @Get(':slug/products/:id')
  async getShopProductById(
    @Param('slug') slug: string,
    @Param('id') id: string,
  ) {
    return this.publicShopService.getShopProductById(validateSlug(slug), id);
  }

  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post(':slug/track-visit')
  @HttpCode(HttpStatus.OK)
  async trackVisit(
    @Param('slug') slug: string,
    @Body() dto?: TrackVisitDto,
  ) {
    return this.publicShopService.trackVisit(validateSlug(slug), dto);
  }
}

