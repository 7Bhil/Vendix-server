import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentCommerce = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const commerce = request.user?.commerce;
    return data ? commerce?.[data] : commerce;
  },
);
