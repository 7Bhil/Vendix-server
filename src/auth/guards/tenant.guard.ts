import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

/**
 * Guard BOLA (Broken Object Level Authorization) & Multi-Tenant.
 *
 * Règles :
 * 1. Tout commerçant authentifié doit obligatoirement être rattaché à un commerce actif.
 * 2. Si une ressource est demandée par ID ou si une opération métier est déclenchée,
 *    l'accès à un commerce différent renvoie systématiquement une erreur 404 (NotFoundException)
 *    plutôt qu'un 403, afin de ne jamais faire fuiter l'existence des identifiants des concurrents.
 * 3. Les administrateurs système (rôle ADMIN) conservent une visibilité globale de supervision.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new NotFoundException('Ressource introuvable.');
    }

    // Les administrateurs peuvent opérer en mode supervision
    if (user.role === 'ADMIN') {
      return true;
    }

    // Pour tout commerçant ou vendeur, un commerce rattaché est obligatoire
    if (!user.commerce || !user.commerce.id) {
      throw new NotFoundException('Ressource introuvable.');
    }

    // Si la requête contient un paramètre de route, de requête, de corps ou un header "x-commerce-id" explicite,
    // vérifier qu'il correspond exactement au commerce du commerçant authentifié
    const headerCommerceId = request.headers?.['x-commerce-id'] || request.headers?.['X-Commerce-Id'];
    const paramCommerceId =
      headerCommerceId ||
      request.params?.commerceId ||
      request.query?.commerceId ||
      request.body?.commerceId;

    if (paramCommerceId && paramCommerceId !== user.commerce.id) {
      // Sécurité BOLA : renvoyer 404 au lieu de 403 pour masquer l'existence de la ressource
      throw new NotFoundException('Ressource introuvable.');
    }

    // Injection automatique et garantie du commerceId sécurisé dans la requête
    request.commerceId = user.commerce.id;

    return true;
  }
}
