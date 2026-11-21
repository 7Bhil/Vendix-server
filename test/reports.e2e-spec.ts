import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Reports & Administration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let adminToken: string;
  const adminUserId = 'a0000000-0000-4000-8000-000000000099';
  const adminPhone = '+22999999999';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );

    await app.init();

    prisma = app.get<PrismaService>(PrismaService);
    jwtService = app.get<JwtService>(JwtService);

    // Créer ou mettre à jour un compte administrateur pour le test
    await prisma.users.upsert({
      where: { phone: adminPhone },
      update: { role: UserRole.ADMIN },
      create: {
        id: adminUserId,
        phone: adminPhone,
        password_hash: 'test-admin-hash',
        role: UserRole.ADMIN,
      },
    });

    const jwtSecret = process.env.JWT_SECRET || 'vendix_super_secret_jwt_access_key_2026';
    adminToken = await jwtService.signAsync(
      {
        sub: adminUserId,
        phone: adminPhone,
        role: UserRole.ADMIN,
      },
      { secret: jwtSecret, expiresIn: '1h' },
    );
  });

  afterAll(async () => {
    try {
      await prisma.reports.deleteMany({
        where: {
          reporter_phone: { in: ['+22997001122', '+22995003344'] },
        },
      });
      await prisma.users.delete({ where: { phone: adminPhone } });
    } catch {
      // Ignorer si déjà supprimé
    }
    await app.close();
  });

  describe('1. Validation stricte du DTO CreateReportDto', () => {
    it('devrait refuser une requête avec une description de moins de 15 caractères (code 400 Bad Request)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/public/reports')
        .send({
          shop_identifier: 'boutique-test',
          report_type: 'FRAUDE',
          reporter_phone: '+22997001122',
          description: 'Trop court', // 10 caractères (< 15)
        })
        .expect(400);

      expect(response.body.message).toEqual(
        expect.arrayContaining([
          expect.stringContaining('15 caractères'),
        ]),
      );
    });

    it('devrait refuser un format de numéro de téléphone invalide (code 400 Bad Request)', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/public/reports')
        .send({
          shop_identifier: 'boutique-test',
          report_type: 'FRAUDE',
          reporter_phone: 'pas-un-telephone',
          description: 'Ceci est une description de test valide de plus de 15 caractères.',
        })
        .expect(400);

      expect(response.body.message).toEqual(
        expect.arrayContaining([
          expect.stringContaining('numéro de téléphone'),
        ]),
      );
    });

    it('devrait refuser une requête sans shop_identifier (code 400 Bad Request)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/public/reports')
        .send({
          report_type: 'FRAUDE',
          reporter_phone: '+22997001122',
          description: 'Ceci est une description de test valide de plus de 15 caractères.',
        })
        .expect(400);
    });
  });

  describe('2. Soumission d’un signalement citoyen valide', () => {
    it('devrait répondre avec succès (code 201 Created) lors de l’envoi d’un signalement complet valide', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/public/reports')
        .send({
          shop_identifier: 'Boutique Test Citoyen',
          report_type: 'FRAUDE_PRIX',
          reporter_name: 'Acheteur Témoin',
          reporter_phone: '+22997001122',
          description: 'Prix affiché en rayon différent du prix facturé à la caisse.',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.status).toBe('EN_ATTENTE');
      expect(response.body.shop_identifier).toBe('Boutique Test Citoyen');
      expect(response.body.report_type).toBe('FRAUDE_PRIX');
      expect(response.body.reporter_phone).toBe('+22997001122');
      expect(response.body.reporter_name).toBe('Acheteur Témoin');
    });

    it('devrait également accepter la route /public/reports', async () => {
      const response = await request(app.getHttpServer())
        .post('/public/reports')
        .send({
          shop_identifier: 'Autre Boutique',
          report_type: 'PRODUIT_PERIME',
          reporter_phone: '+22995003344',
          description: 'Vente de lait infantile périmé depuis le mois dernier.',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.status).toBe('EN_ATTENTE');
    });
  });

  describe('3. Consultation d’administration des signalements', () => {
    it('devrait afficher les signalements enregistrés dans GET /admin/reports', async () => {
      const response = await request(app.getHttpServer())
        .get('/admin/reports')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);

      const found = response.body.find(
        (r: any) => r.reporter_phone === '+22997001122',
      );
      expect(found).toBeDefined();
      expect(found.report_type).toBe('FRAUDE_PRIX');
      expect(found.status).toBe('EN_ATTENTE');
    });

    it('devrait également fonctionner via GET /api/v1/admin/reports', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/admin/reports')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('devrait refuser l’accès sans jeton d’authentification (code 401 Unauthorized)', async () => {
      await request(app.getHttpServer())
        .get('/admin/reports')
        .expect(401);
    });
  });
});
