import { Module } from '@nestjs/common';
import { PublicShopController } from './public-shop.controller.js';
import { PublicShopService } from './public-shop.service.js';

@Module({
  controllers: [PublicShopController],
  providers: [PublicShopService],
  exports: [PublicShopService],
})
export class PublicShopModule {}
