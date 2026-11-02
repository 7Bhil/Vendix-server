import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @IsNotEmpty({ message: 'Le jeton de rafraîchissement est obligatoire.' })
  @IsString()
  refresh_token!: string;
}
