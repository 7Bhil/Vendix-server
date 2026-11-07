import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';

/**
 * Intercepteur de contexte Multi-Tenant.
 *
 * Attache de manière infalsifiable le `commerceId` issu du jeton JWT authentifié
 * sur l'objet Request ainsi que sur les corps de requête (body) de création / mutation.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (user && user.commerce?.id) {
      request.commerceId = user.commerce.id;

      // Si c'est une requête de mutation avec un payload JSON,
      // on s'assure que le commerceId injecté provient toujours du token et ne peut pas être falsifié
      if (request.body && typeof request.body === 'object') {
        request.body.commerce_id = user.commerce.id;
      }
    }

    return next.handle();
  }
}
