import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ReportStatus } from '@prisma/client';

export enum ReportReason {
  FRAUDE = 'FRAUDE',
  PRODUIT_NON_CONFORME = 'PRODUIT_NON_CONFORME',
  PRIX_ABUSIF = 'PRIX_ABUSIF',
  AUTRE = 'AUTRE',
}

export class CreateReportDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  target_slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  targetSlug?: string;

  @IsNotEmpty({ message: 'Le motif du signalement est obligatoire.' })
  @IsString()
  @MaxLength(80)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  reporter_phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  reporterPhone?: string;

  @IsNotEmpty({ message: 'La description du signalement est obligatoire.' })
  @IsString()
  @MaxLength(2000)
  description!: string;

  @IsOptional()
  @IsArray({ message: 'Les preuves doivent être fournies sous forme de liste d’URLs.' })
  @IsString({ each: true })
  evidence_urls?: string[];

  @IsOptional()
  @IsArray({ message: 'Les preuves doivent être fournies sous forme de liste d’URLs.' })
  @IsString({ each: true })
  evidenceUrls?: string[];
}

export class UpdateReportStatusDto {
  @IsEnum(ReportStatus, {
    message:
      'Statut invalide. Valeurs autorisées : EN_ATTENTE, EN_COURS, RESOLU, REJETE.',
  })
  status!: ReportStatus;
}

