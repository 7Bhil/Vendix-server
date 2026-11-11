import { Body, Controller, Get, Patch } from '@nestjs/common';
import { CurrentCommerce } from '../auth/decorators/current-commerce.decorator.js';
import { CommerceService } from './commerce.service.js';
import { UpdateCommerceSettingsDto } from './dto/commerce-settings.dto.js';

@Controller(['api/v1/commerce', 'commerce'])
export class CommerceController {
  constructor(private readonly commerceService: CommerceService) {}

  @Get('settings')
  async getSettings(@CurrentCommerce('id') commerceId: string) {
    return this.commerceService.getSettings(commerceId);
  }

  @Patch('settings')
  async updateSettings(
    @CurrentCommerce('id') commerceId: string,
    @Body() dto: UpdateCommerceSettingsDto,
  ) {
    return this.commerceService.updateSettings(commerceId, dto);
  }
}

