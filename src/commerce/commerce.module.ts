import { Module } from '@nestjs/common';
import { CommerceController } from './commerce.controller.js';
import { CommerceService } from './commerce.service.js';

@Module({
  controllers: [CommerceController],
  providers: [CommerceService],
  exports: [CommerceService],
})
export class CommerceModule {}

