import { describe, it, expect, beforeEach } from 'vitest';
import { AdminController } from './admin.controller.js';

describe('AdminController', () => {
  let controller: AdminController;

  beforeEach(() => {
    controller = new AdminController();
  });

  it('devrait retourner les métriques consolidées du dashboard admin', async () => {
    const stats = await controller.getDashboardStats();

    expect(stats).toBeDefined();
    expect(stats.totalMerchants).toBe(42);
    expect(stats.activeMerchants).toBe(38);
    expect(stats.suspendedMerchants).toBe(4);
    expect(stats.totalVolumeFCFA).toBe(18450000);
    expect(stats.pendingReports).toBe(3);
  });

  it('devrait retourner la liste des commerçants', async () => {
    const merchants = await controller.getMerchants();

    expect(Array.isArray(merchants)).toBe(true);
    expect(merchants.length).toBeGreaterThan(0);
    expect(merchants[0]).toHaveProperty('id');
    expect(merchants[0]).toHaveProperty('fullName');
    expect(merchants[0]).toHaveProperty('phone');
    expect(merchants[0]).toHaveProperty('status', 'ACTIF');
  });

  it('devrait enregistrer la suspension d’un commerçant avec motif obligatoire ou par défaut', async () => {
    const res = await controller.suspendMerchant('m-001', { reason: 'Litige non résolu' });

    expect(res).toEqual({
      success: true,
      id: 'm-001',
      status: 'SUSPENDU',
      reason: 'Litige non résolu',
    });
  });

  it('devrait mettre à jour le statut d’un signalement citoyen', async () => {
    const res = await controller.updateReport('rep-123', { status: 'RESOLU' });

    expect(res).toEqual({
      success: true,
      id: 'rep-123',
      status: 'RESOLU',
    });
  });
});
