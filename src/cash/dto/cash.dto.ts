import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export enum CashDiscrepancyType {
  SURPLUS = 'surplus',
  MISSING = 'missing',
  BALANCED = 'balanced',
}

export class CreateCashClosureDto {
  @ValidateIf(
    (o: CreateCashClosureDto) =>
      o.physical_cash === undefined && o.counted_amount === undefined,
  )
  @IsInt({
    message: 'Le montant physique compté doit être un entier en FCFA (sans centimes).',
  })
  @Min(0, { message: 'Le montant physique compté ne peut pas être négatif.' })
  actual_cash_counted?: number;

  @ValidateIf(
    (o: CreateCashClosureDto) =>
      o.actual_cash_counted === undefined && o.counted_amount === undefined,
  )
  @IsInt({
    message: 'Le montant physique compté doit être un entier en FCFA (sans centimes).',
  })
  @Min(0, { message: 'Le montant physique compté ne peut pas être négatif.' })
  physical_cash?: number;

  @ValidateIf(
    (o: CreateCashClosureDto) =>
      o.actual_cash_counted === undefined && o.physical_cash === undefined,
  )
  @IsInt({
    message: 'Le montant physique compté doit être un entier en FCFA (sans centimes).',
  })
  @Min(0, { message: 'Le montant physique compté ne peut pas être négatif.' })
  counted_amount?: number;

  @IsOptional()
  @IsInt({
    message: 'Le fond de caisse initial doit être un entier en FCFA (sans centimes).',
  })
  @Min(0, { message: 'Le fond de caisse initial ne peut pas être négatif.' })
  opening_amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500, {
    message: 'Le commentaire explicatif ne peut pas dépasser 500 caractères.',
  })
  comment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, {
    message: 'Les notes explicatives ne peuvent pas dépasser 500 caractères.',
  })
  notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, {
    message: 'L’explication ne peut pas dépasser 500 caractères.',
  })
  explanation?: string;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  client_op_uuid?: string;
}

