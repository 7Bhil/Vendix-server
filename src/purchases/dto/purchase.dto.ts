import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod, PurchaseStatus } from '@prisma/client';

export class PurchaseLineInputDto {
  @IsNotEmpty({ message: 'L’ID du produit est obligatoire.' })
  @IsString()
  product_id!: string;

  @IsNumber({}, { message: 'La quantité doit être un nombre.' })
  @IsPositive({ message: 'La quantité doit être strictement positive.' })
  quantity!: number;

  @IsNotEmpty({ message: 'L’unité d’achat est obligatoire.' })
  @IsString()
  unit_label!: string;

  @IsInt({ message: 'Le coût unitaire d’achat doit être un entier en FCFA.' })
  @Min(0)
  unit_cost!: number;
}

export class CreatePurchaseDto {
  @IsNotEmpty({ message: 'Le fournisseur est obligatoire.' })
  @IsString()
  supplier_id!: string;

  @IsArray({ message: 'La commande d’achat doit contenir au moins une ligne de produit.' })
  @ValidateNested({ each: true })
  @Type(() => PurchaseLineInputDto)
  lines!: PurchaseLineInputDto[];

  @IsInt({ message: 'Le montant versé doit être un entier en FCFA.' })
  @Min(0)
  amount_paid!: number;

  @IsEnum(PaymentMethod, {
    message: 'Mode de règlement invalide (CASH, MOMO, CREDIT, SPLIT).',
  })
  payment_method!: PaymentMethod;

  @IsOptional()
  @IsEnum(PurchaseStatus, {
    message: 'Statut de commande invalide (PENDING, RECEIVED, ORDERED, COMPLETED).',
  })
  status?: PurchaseStatus;

  @IsOptional()
  @IsString()
  client_op_uuid?: string;
}

