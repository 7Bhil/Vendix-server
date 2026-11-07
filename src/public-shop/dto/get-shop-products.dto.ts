import { IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class GetShopProductsDto {
  @IsOptional()
  @IsUUID('4', { message: 'La catégorie doit être un UUID valide.' })
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80, { message: 'La recherche ne peut pas dépasser 80 caractères.' })
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'La limite doit être un entier.' })
  @Min(1)
  @Max(100)
  limit: number = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Le décalage (offset) doit être un entier.' })
  @Min(0)
  offset: number = 0;
}
