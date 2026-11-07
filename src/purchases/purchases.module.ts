import { Module } from '@nestjs/common';
import { PurchasesController } from './purchases.controller.js';
import { PurchasesService } from './purchases.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [PurchasesController],
  providers: [PurchasesService],
  exports: [PurchasesService],
})
export class PurchasesModule {}

