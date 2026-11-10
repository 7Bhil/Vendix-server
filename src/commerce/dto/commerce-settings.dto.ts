import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export const ALLOWED_RECEIPT_FORMATS = ['58mm', '80mm', '58 mm', '80 mm'] as const;

export class UpdateCommerceSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  whatsapp_phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  whatsapp_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  whatsappPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  whatsappNumber?: string;

  @IsOptional()
  @IsString()
  logo_url?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'La couleur principale doit être au format hexadécimal (#RRGGBB).',
  })
  primary_color?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'La couleur principale doit être au format hexadécimal (#RRGGBB).',
  })
  primaryColor?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'La couleur secondaire doit être au format hexadécimal (#RRGGBB).',
  })
  secondary_color?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'La couleur secondaire doit être au format hexadécimal (#RRGGBB).',
  })
  secondaryColor?: string;

  @IsOptional()
  @IsIn(ALLOWED_RECEIPT_FORMATS, {
    message: 'Format de ticket invalide. Formats supportés : 58mm, 80mm.',
  })
  receipt_format?: string;

  @IsOptional()
  @IsIn(ALLOWED_RECEIPT_FORMATS, {
    message: 'Format de ticket invalide. Formats supportés : 58mm, 80mm.',
  })
  receiptFormat?: string;

  @IsOptional()
  @IsBoolean()
  show_views_public?: boolean;

  @IsOptional()
  @IsBoolean()
  showViewsPublic?: boolean;

  @IsOptional()
  @IsBoolean()
  showViewsToPublic?: boolean;
}

