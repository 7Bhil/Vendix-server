import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentCommerce } from '../auth/decorators/current-commerce.decorator.js';
import { CommerceService } from './commerce.service.js';
import type { UploadedFilePayload } from './commerce.service.js';
import { UpdateCommerceDto } from './dto/update-commerce.dto.js';

@Controller(['api/v1/commerce', 'commerce'])
export class CommerceController {
  constructor(private readonly commerceService: CommerceService) {}

  @Get(['', 'settings'])
  async getSettings(
    @CurrentCommerce('id') commerceId: string,
    @Req() req: any,
  ) {
    const effectiveCommerceId = commerceId || req.commerceId || req.user?.commerce?.id;
    return this.commerceService.getSettings(effectiveCommerceId);
  }

  @Patch(['', 'settings'])
  async updateSettings(
    @CurrentCommerce('id') commerceId: string,
    @Body() dto: UpdateCommerceDto,
    @Req() req: any,
  ) {
    const effectiveCommerceId = commerceId || req.commerceId || req.user?.commerce?.id;
    return this.commerceService.updateSettings(effectiveCommerceId, dto);
  }

  @Post(['upload-logo', 'logo'])
  @UseInterceptors(FileInterceptor('file'))
  async uploadLogo(
    @CurrentCommerce('id') commerceId: string,
    @UploadedFile() file?: UploadedFilePayload,
    @Body() body?: { logo?: string; file?: string; base64?: string },
    @Req() req?: any,
  ) {
    const effectiveCommerceId =
      commerceId || req?.commerceId || req?.user?.commerce?.id;
    const base64Data = body?.logo || body?.file || body?.base64;
    return this.commerceService.uploadLogo(effectiveCommerceId, file, base64Data);
  }
}
