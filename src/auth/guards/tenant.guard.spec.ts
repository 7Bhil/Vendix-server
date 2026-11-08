import { describe, expect, it, vi } from 'vitest';
import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenantGuard } from './tenant.guard.js';

describe('TenantGuard', () => {
  const reflector = new Reflector();
  const guard = new TenantGuard(reflector);

  function createMockContext(
    user: any,
    params: any = {},
    query: any = {},
    body: any = {},
    headers: any = {},
  ): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          user,
          params,
          query,
          body,
          headers,
        }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;
  }

  it('devrait autoriser les requêtes publiques', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const ctx = createMockContext(null);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('devrait rejeter si l’utilisateur n’est pas authentifié sur route privée', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const ctx = createMockContext(null);
    expect(() => guard.canActivate(ctx)).toThrow(NotFoundException);
  });

  it('devrait autoriser les administrateurs avec accès global', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const adminUser = { id: 'admin-1', role: 'ADMIN' };
    const ctx = createMockContext(adminUser);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('devrait bloquer un commerçant qui tente d’accéder aux données d’un autre commerce (BOLA 404)', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const merchantUser = {
      id: 'merchant-1',
      role: 'MERCHANT',
      commerce: { id: 'comm-123' },
    };

    // Tente de requêter le commerce comm-999 d'un concurrent
    const ctx = createMockContext(merchantUser, { commerceId: 'comm-999' });
    expect(() => guard.canActivate(ctx)).toThrow(NotFoundException);
  });

  it('devrait autoriser et injecter commerceId si le commerçant accède à son propre commerce', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const merchantUser = {
      id: 'merchant-1',
      role: 'MERCHANT',
      commerce: { id: 'comm-123' },
    };

    const req: any = {
      user: merchantUser,
      params: { commerceId: 'comm-123' },
      query: {},
      body: {},
    };

    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;

    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.commerceId).toBe('comm-123');
  });

  it('devrait bloquer un commerçant qui envoie un header x-commerce-id usurpé d’un concurrent', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const merchantUser = {
      id: 'merchant-1',
      role: 'MERCHANT',
      commerce: { id: 'comm-123' },
    };

    const ctx = createMockContext(merchantUser, {}, {}, {}, { 'x-commerce-id': 'comm-hacker' });
    expect(() => guard.canActivate(ctx)).toThrow(NotFoundException);
  });

  it('devrait autoriser si le header x-commerce-id correspond au commerce authentifié', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const merchantUser = {
      id: 'merchant-1',
      role: 'MERCHANT',
      commerce: { id: 'comm-123' },
    };

    const ctx = createMockContext(merchantUser, {}, {}, {}, { 'x-commerce-id': 'comm-123' });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
