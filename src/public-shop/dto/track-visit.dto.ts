import { IsOptional, IsUUID } from 'class-validator';

export class TrackVisitDto {
  @IsOptional()
  @IsUUID('4', { message: 'L’identifiant du produit doit être un UUID valide.' })
  product_id?: string;

  @IsOptional()
  @IsUUID('4', { message: 'L’identifiant du produit doit être un UUID valide.' })
  productId?: string;
}
