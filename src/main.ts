import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Protection des headers HTTP essentiels (anti-XSS, anti-clickjacking, HSTS)
  app.use(helmet());

  // CORS sécurisé
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim())
    : [
        'http://localhost:5173',
        'http://localhost:3000',
        'http://localhost:4173',
        /^https?:\/\/([a-zA-Z0-9-]+\.)?vendix\.(local|com|bj)$/,
      ];

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Idempotency-Key',
      'x-commerce-id',
      'X-Commerce-Id',
    ],
  });

  // Validation stricte des entrées et filtrage automatique des champs non autorisés
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Vendix server is running on http://localhost:${port}`);
}

await bootstrap();
