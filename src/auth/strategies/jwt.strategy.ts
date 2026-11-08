import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service.js';
import { JwtPayload } from '../interfaces/jwt-payload.interface.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly prisma: PrismaService) {
    const jwtSecret = process.env.JWT_SECRET || (process.env.NODE_ENV === 'test' ? 'test_jwt_access_secret_key_32_characters_long' : undefined);
    if (!jwtSecret || jwtSecret.length < 32) {
      throw new Error('FATAL: JWT_SECRET must be defined in environment and contain at least 32 characters.');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.users.findUnique({
      where: { id: payload.sub },
      include: { commerce: true },
    });

    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable ou session révoquée.');
    }

    const { password_hash: _hash, refresh_token: _token, ...safeUser } = user;
    return safeUser;
  }
}
