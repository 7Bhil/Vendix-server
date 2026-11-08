import { IsNotEmpty, IsOptional, IsString, Length, Matches, IsEmail } from 'class-validator';

export class RegisterDto {
  @IsNotEmpty({ message: 'Le numéro de téléphone est obligatoire.' })
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'Le numéro de téléphone doit respecter le format international E.164 (ex: +229XXXXXXXX).',
  })
  phone!: string;

  @IsNotEmpty({ message: 'Le mot de passe est obligatoire.' })
  @IsString()
  @Length(6, 64, { message: 'Le mot de passe doit contenir entre 6 et 64 caractères.' })
  password!: string;

  @IsOptional()
  @IsEmail({}, { message: 'Adresse email de récupération invalide.' })
  email_recovery?: string;

  @IsOptional()
  @IsString()
  commerce_name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'Le numéro WhatsApp doit respecter le format international E.164 (ex: +229XXXXXXXX).',
  })
  whatsapp_number?: string;
}
