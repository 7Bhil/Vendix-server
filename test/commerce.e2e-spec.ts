import 'dotenv/config';
import { ValidationPipe, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

describe('Commerce Settings (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let testCommerce: any;
  let testUser: any;
  let authToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);

    // Trouver un utilisateur et commerce existant ou en créer un pour le test
    testCommerce = await prisma.commerces.findFirst();
    if (testCommerce) {
      testUser = await prisma.users.findUnique({
        where: { id: testCommerce.user_id },
      });
    }

    if (!testCommerce || !testUser) {
      testUser = await prisma.users.create({
        data: {
          phone: `+22997${Math.floor(100000 + Math.random() * 900000)}`,
          password_hash: 'hash_test_fake',
          role: 'COMMERCANT',
        },
      });

      testCommerce = await prisma.commerces.create({
        data: {
          user_id: testUser.id,
          name: 'Boutique E2E Test',
          slug: `boutique-e2e-${Date.now()}`,
          whatsapp_number: testUser.phone,
          primary_color: '#15803d',
          secondary_color: '#ca8a04',
          receipt_format: '58mm',
          show_views_public: true,
        },
      });
    }

    authToken = await jwtService.signAsync(
      {
        sub: testUser.id,
        phone: testUser.phone,
        role: testUser.role,
        commerce_id: testCommerce.id,
      },
      {
        secret: process.env.JWT_SECRET || 'vendix_secret_jwt_access_change_me_in_dev_or_ask_lead',
        expiresIn: '1h',
      },
    );
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('GET /commerce/settings doit renvoyer les paramètres de la boutique avec status 200', async () => {
    const response = await request(app.getHttpServer())
      .get('/commerce/settings')
      .set('Authorization', `Bearer ${authToken}`)
      .set('x-commerce-id', testCommerce.id)
      .expect(200);

    expect(response.body).toHaveProperty('id', testCommerce.id);
    expect(response.body).toHaveProperty('name', testCommerce.name);
    expect(response.body).toHaveProperty('slug', testCommerce.slug);
    expect(response.body).toHaveProperty('primaryColor');
    expect(response.body).toHaveProperty('secondaryColor');
    expect(response.body).toHaveProperty('receiptFormat');
  });

  it('PATCH /commerce/settings doit modifier les paramètres et persister en DB', async () => {
    const updatedName = `Boutique Sync ${Date.now()}`;
    const response = await request(app.getHttpServer())
      .patch('/commerce/settings')
      .set('Authorization', `Bearer ${authToken}`)
      .set('x-commerce-id', testCommerce.id)
      .send({
        name: updatedName,
        primaryColor: '#047857',
        secondaryColor: '#b45309',
        receiptFormat: '80mm',
        showViewsToPublic: false,
      })
      .expect(200);

    expect(response.body.name).toBe(updatedName);
    expect(response.body.primaryColor).toBe('#047857');
    expect(response.body.secondaryColor).toBe('#b45309');
    expect(response.body.receiptFormat).toBe('80mm');
    expect(response.body.showViewsToPublic).toBe(false);

    // Vérifier en base directement
    const dbRecord = await prisma.commerces.findUnique({
      where: { id: testCommerce.id },
    });
    expect(dbRecord?.name).toBe(updatedName);
    expect(dbRecord?.primary_color).toBe('#047857');
    expect(dbRecord?.secondary_color).toBe('#b45309');
    expect(dbRecord?.receipt_format).toBe('80mm');
    expect(dbRecord?.show_views_public).toBe(false);
  });

  it('GET /public/shop/:slug doit refléter les réglages modifiés', async () => {
    const response = await request(app.getHttpServer())
      .get(`/public/shop/${testCommerce.slug}`)
      .expect(200);

    expect(response.body.primaryColor).toBe('#047857');
    expect(response.body.secondaryColor).toBe('#b45309');
    expect(response.body.showViewsToPublic).toBe(false);
  });
});
