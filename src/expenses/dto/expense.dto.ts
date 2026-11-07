import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export enum ExpenseCategory {
  RENT = 'RENT',
  TRANSPORT = 'TRANSPORT',
  ELECTRICITY = 'ELECTRICITY',
  PACKAGING = 'PACKAGING',
  OTHER = 'OTHER',
}

export enum ExpensePaymentMethod {
  CASH = 'CASH',
  MOMO = 'MOMO',
}

export class CreateExpenseDto {
  @IsInt({ message: 'Le montant de la dépense doit être un entier en FCFA (sans centimes).' })
  @Min(1, { message: 'Le montant de la dépense doit être strictement positif (minimum 1 FCFA).' })
  amount!: number;

  @IsEnum(ExpenseCategory, {
    message: 'Catégorie de dépense invalide (RENT, TRANSPORT, ELECTRICITY, PACKAGING, OTHER).',
  })
  category!: ExpenseCategory;

  @ValidateIf((o: CreateExpenseDto) => !o.mode)
  @IsEnum(ExpensePaymentMethod, {
    message: 'Mode de paiement invalide (CASH ou MOMO).',
  })
  payment_method?: ExpensePaymentMethod;

  @ValidateIf((o: CreateExpenseDto) => !o.payment_method)
  @IsEnum(ExpensePaymentMethod, {
    message: 'Mode de paiement invalide (CASH ou MOMO).',
  })
  mode?: ExpensePaymentMethod;

  @ValidateIf((o: CreateExpenseDto) => !o.reason && !o.description)
  @IsNotEmpty({ message: 'Le motif de la dépense est obligatoire.' })
  @IsString()
  @MaxLength(255, { message: 'Le motif ne peut pas dépasser 255 caractères.' })
  motif?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'Le motif ne peut pas dépasser 255 caractères.' })
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'La description ne peut pas dépasser 255 caractères.' })
  description?: string;

  @IsOptional()
  @IsString()
  client_op_uuid?: string;
}

