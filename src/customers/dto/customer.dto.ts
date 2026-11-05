import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PaymentMethod } from '@prisma/client';

export class CreateCustomerDto {
  @IsNotEmpty({ message: 'Le nom complet du client est obligatoire.' })
  @IsString()
  @MaxLength(100, { message: 'Le nom ne peut pas dépasser 100 caractères.' })
  full_name!: string;

  @IsNotEmpty({ message: 'Le numéro de téléphone est obligatoire.' })
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'Le téléphone doit respecter le format international E.164 (ex: +229XXXXXXXX).',
  })
  phone!: string;
}

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  full_name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'Le téléphone doit respecter le format international E.164 (ex: +229XXXXXXXX).',
  })
  phone?: string;
}

export class CreateRepaymentDto {
  @IsInt({ message: 'Le montant du remboursement doit être un entier en FCFA.' })
  @Min(1, { message: 'Le montant du remboursement doit être d’au moins 1 FCFA.' })
  amount!: number;

  @IsEnum(PaymentMethod, { message: 'Moyen de paiement invalide (CASH, MOMO, CREDIT, SPLIT).' })
  payment_method!: PaymentMethod;

  @IsOptional()
  @IsString()
  notes?: string;
}
