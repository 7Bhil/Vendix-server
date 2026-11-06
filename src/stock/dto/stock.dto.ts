import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export enum StockLevel {
  NORMAL = 'NORMAL',
  LOW = 'LOW',
  OUT_OF_STOCK = 'OUT_OF_STOCK',
}

export enum ManualStockMotif {
  ENTRY = 'ENTRY',
  LOSS = 'LOSS',
  CORRECTION = 'CORRECTION',
}

export class CreateStockMovementDto {
  @IsOptional()
  @IsString()
  product_id?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  motif?: string;

  @IsNotEmpty({ message: 'La quantité est obligatoire.' })
  @IsNumber({}, { message: 'La quantité doit être un nombre.' })
  quantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  unit_label?: string;

  @IsOptional()
  @IsNumber({}, { message: 'Le facteur de conversion doit être un nombre.' })
  @IsPositive({ message: 'Le facteur de conversion doit être strictement positif.' })
  conversion_factor?: number;

  @IsOptional()
  @IsString()
  @MaxLength(150, { message: 'Le motif ou commentaire ne peut pas dépasser 150 caractères.' })
  reason?: string;

  @IsOptional()
  @IsString()
  client_op_uuid?: string;
}

