import {
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateCategoryDto {
  @IsNotEmpty({ message: 'Le nom de la catégorie est obligatoire.' })
  @IsString()
  @MaxLength(80, { message: 'Le nom ne peut pas dépasser 80 caractères.' })
  name!: string;
}

export class UpdateCategoryDto {
  @IsNotEmpty({ message: 'Le nom de la catégorie est obligatoire.' })
  @IsString()
  @MaxLength(80, { message: 'Le nom ne peut pas dépasser 80 caractères.' })
  name!: string;
}
