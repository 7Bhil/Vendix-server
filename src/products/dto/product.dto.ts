import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ProductUnitInputDto {
  @IsNotEmpty({ message: 'Le libellé de l’unité est obligatoire.' })
  @IsString()
  @MaxLength(50)
  label!: string;

  @IsNumber({}, { message: 'Le facteur de conversion doit être un nombre.' })
  @IsPositive({ message: 'Le facteur de conversion doit être strictement positif.' })
  conversion_factor!: number;

  @IsInt({ message: 'Le prix de détail doit être un entier en FCFA.' })
  @Min(0, { message: 'Le prix de détail ne peut pas être négatif.' })
  retail_price!: number;

  @IsOptional()
  @IsInt({ message: 'Le prix de gros doit être un entier en FCFA.' })
  @Min(0, { message: 'Le prix de gros ne peut pas être négatif.' })
  wholesale_price?: number;

  @IsOptional()
  @IsBoolean()
  is_base_unit?: boolean;
}

export class CreateProductDto {
  @IsNotEmpty({ message: 'Le nom du produit est obligatoire.' })
  @IsString()
  @MaxLength(120, { message: 'Le nom du produit ne peut pas dépasser 120 caractères.' })
  name!: string;

  @IsOptional()
  @IsString()
  category_id?: string;

  @IsOptional()
  @IsString()
  image_url?: string;

  @IsOptional()
  @IsInt({ message: 'Le coût de revient par défaut doit être un entier en FCFA.' })
  @Min(0, { message: 'Le coût de revient ne peut pas être négatif.' })
  default_cost_price?: number;

  @IsOptional()
  @IsBoolean()
  is_visible_public?: boolean;

  @IsOptional()
  @IsNumber({}, { message: 'Le stock initial doit être un nombre.' })
  initial_stock?: number;

  @IsArray({ message: 'Les unités doivent être sous forme de liste.' })
  @ValidateNested({ each: true })
  @Type(() => ProductUnitInputDto)
  units!: ProductUnitInputDto[];
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  category_id?: string;

  @IsOptional()
  @IsString()
  image_url?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  default_cost_price?: number;

  @IsOptional()
  @IsBoolean()
  is_visible_public?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductUnitInputDto)
  units?: ProductUnitInputDto[];
}
