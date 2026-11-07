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

export class CreateSupplierDto {
  @IsNotEmpty({ message: 'Le nom du fournisseur est obligatoire.' })
  @IsString()
  @MaxLength(100, { message: 'Le nom ne peut pas dépasser 100 caractères.' })
  name!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'Le téléphone doit respecter le format international E.164 (ex: +229XXXXXXXX).',
  })
  phone?: string;
}

export class UpdateSupplierDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'Le téléphone doit respecter le format international E.164 (ex: +229XXXXXXXX).',
  })
  phone?: string;
}

export class CreateSupplierPaymentDto {
  @IsInt({ message: 'Le montant du versement doit être un entier en FCFA.' })
  @Min(1, { message: 'Le montant du versement doit être d’au moins 1 FCFA.' })
  amount!: number;

  @IsOptional()
  @IsEnum(PaymentMethod, { message: 'Moyen de paiement invalide (CASH, MOMO, CREDIT, SPLIT).' })
  payment_method?: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  notes?: string;
}

