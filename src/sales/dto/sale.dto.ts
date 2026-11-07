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
import { PaymentMethod } from '@prisma/client';

export class SaleLineInputDto {
  @IsNotEmpty({ message: 'L’ID du produit est obligatoire.' })
  @IsString()
  product_id!: string;

  @IsNumber({}, { message: 'La quantité doit être un nombre.' })
  @IsPositive({ message: 'La quantité doit être strictement positive.' })
  quantity!: number;

  @IsNotEmpty({ message: 'L’ID ou libellé de l’unité est obligatoire.' })
  @IsString()
  unit_label!: string;

  @IsOptional()
  @IsNumber()
  conversion_factor?: number;

  @IsInt({ message: 'Le prix unitaire doit être un entier en FCFA.' })
  @Min(0)
  unit_price!: number;
}

export class CreateSaleDto {
  @IsOptional()
  @IsString()
  customer_id?: string;

  @IsArray({ message: 'La vente doit contenir au moins une ligne d’article.' })
  @ValidateNested({ each: true })
  @Type(() => SaleLineInputDto)
  lines!: SaleLineInputDto[];

  @IsInt({ message: 'Le montant versé doit être un entier en FCFA.' })
  @Min(0)
  amount_paid!: number;

  @IsEnum(PaymentMethod, { message: 'Mode de paiement invalide (CASH, MOMO, CREDIT, SPLIT).' })
  payment_method!: PaymentMethod;

  @IsOptional()
  @IsString()
  client_op_uuid?: string;
}
