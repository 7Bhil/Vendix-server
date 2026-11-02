import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class LoginDto {
  @IsNotEmpty({ message: 'Le numéro de téléphone est obligatoire.' })
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'Le numéro de téléphone doit respecter le format international E.164 (ex: +229XXXXXXXX).',
  })
  phone!: string;

  @IsNotEmpty({ message: 'Le mot de passe est obligatoire.' })
  @IsString()
  password!: string;
}
