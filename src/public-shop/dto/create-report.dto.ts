import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateReportDto {
  @ValidateIf((o) => !o.shopIdentifier)
  @IsNotEmpty({
    message: "L'identifiant de la boutique (shop_identifier) est obligatoire.",
  })
  @IsString({
    message: "L'identifiant de la boutique doit être une chaîne de caractères.",
  })
  shop_identifier?: string;

  @IsOptional()
  @IsString()
  shopIdentifier?: string;

  @IsOptional()
  @IsString({
    message: 'Le slug de la boutique doit être une chaîne de caractères.',
  })
  shop_slug?: string;

  @IsOptional()
  @IsString()
  shopSlug?: string;

  @ValidateIf((o) => !o.reportType)
  @IsNotEmpty({
    message: 'Le type de signalement (report_type) est obligatoire.',
  })
  @IsString({
    message: 'Le type de signalement doit être une chaîne de caractères.',
  })
  report_type?: string;

  @IsOptional()
  @IsString()
  reportType?: string;

  @IsOptional()
  @IsString({
    message: 'Le nom du déclarant doit être une chaîne de caractères.',
  })
  reporter_name?: string;

  @IsOptional()
  @IsString()
  reporterName?: string;

  @ValidateIf((o) => !o.reporterPhone)
  @IsNotEmpty({
    message: 'Le numéro de téléphone (reporter_phone) est obligatoire.',
  })
  @IsString({
    message: 'Le numéro de téléphone doit être une chaîne de caractères.',
  })
  @Matches(/^\+?[0-9\s-]{8,20}$/, {
    message: 'Le format du numéro de téléphone est invalide.',
  })
  reporter_phone?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9\s-]{8,20}$/, {
    message: 'Le format du numéro de téléphone est invalide.',
  })
  reporterPhone?: string;

  @IsNotEmpty({
    message: 'La description du signalement est obligatoire.',
  })
  @IsString({
    message: 'La description doit être une chaîne de caractères.',
  })
  @MinLength(15, {
    message: 'La description doit comporter au moins 15 caractères.',
  })
  description!: string;
}
