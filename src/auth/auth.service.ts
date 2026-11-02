import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { AuthTokens, JwtPayload } from './interfaces/jwt-payload.interface.js';

@Injectable()
export class AuthService {
  private readonly jwtAccessSecret =
    process.env.JWT_SECRET || 'vendix_jwt_access_secret_key_change_in_production_2026';
  private readonly jwtRefreshSecret =
    process.env.JWT_REFRESH_SECRET || 'vendix_jwt_refresh_secret_key_change_in_production_2026';

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.users.findUnique({
      where: { phone: dto.phone },
    });

    if (existing) {
      throw new ConflictException('Un compte associé à ce numéro de téléphone existe déjà.');
    }

    const password_hash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
    });

    const role = dto.role ?? UserRole.MERCHANT;

    const user = await this.prisma.$transaction(async (tx) => {
      const newUser = await tx.users.create({
        data: {
          phone: dto.phone,
          password_hash,
          email_recovery: dto.email_recovery,
          role,
        },
      });

      if (role === UserRole.MERCHANT) {
        const commerceName = dto.commerce_name?.trim() || `Boutique ${dto.phone.slice(-4)}`;
        const baseSlug = commerceName
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)+/g, '');
        const uniqueSlug = `${baseSlug || 'boutique'}-${Math.random().toString(36).substring(2, 7)}`;

        await tx.commerces.create({
          data: {
            user_id: newUser.id,
            name: commerceName,
            slug: uniqueSlug,
            whatsapp_number: dto.whatsapp_number || dto.phone,
          },
        });
      }

      return tx.users.findUniqueOrThrow({
        where: { id: newUser.id },
        include: { commerce: true },
      });
    });

    const tokens = await this.generateTokens({
      sub: user.id,
      phone: user.phone,
      role: user.role,
      commerceId: user.commerce?.id,
    });

    await this.updateRefreshToken(user.id, tokens.refresh_token);

    const { password_hash: _, refresh_token: __, ...safeUser } = user;
    return {
      user: safeUser,
      tokens,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.users.findUnique({
      where: { phone: dto.phone },
      include: { commerce: true },
    });

    if (!user) {
      throw new UnauthorizedException('Identifiants de connexion incorrects.');
    }

    const passwordMatches = await argon2.verify(user.password_hash, dto.password);
    if (!passwordMatches) {
      throw new UnauthorizedException('Identifiants de connexion incorrects.');
    }

    const tokens = await this.generateTokens({
      sub: user.id,
      phone: user.phone,
      role: user.role,
      commerceId: user.commerce?.id,
    });

    await this.updateRefreshToken(user.id, tokens.refresh_token);

    const { password_hash: _, refresh_token: __, ...safeUser } = user;
    return {
      user: safeUser,
      tokens,
    };
  }

  async refreshTokens(dto: RefreshTokenDto) {
    let payload: JwtPayload;

    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(dto.refresh_token, {
        secret: this.jwtRefreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Jeton de rafraîchissement invalide ou expiré.');
    }

    const user = await this.prisma.users.findUnique({
      where: { id: payload.sub },
      include: { commerce: true },
    });

    if (!user || !user.refresh_token) {
      throw new UnauthorizedException('Accès révoqué. Veuillez vous reconnecter.');
    }

    const refreshTokenMatches = await argon2.verify(user.refresh_token, dto.refresh_token);
    if (!refreshTokenMatches) {
      // Invalider en cas de tentative de rejeu
      await this.prisma.users.update({
        where: { id: user.id },
        data: { refresh_token: null },
      });
      throw new UnauthorizedException('Jeton de rafraîchissement compromis ou invalide.');
    }

    const tokens = await this.generateTokens({
      sub: user.id,
      phone: user.phone,
      role: user.role,
      commerceId: user.commerce?.id,
    });

    await this.updateRefreshToken(user.id, tokens.refresh_token);

    return tokens;
  }

  async logout(userId: string) {
    await this.prisma.users.update({
      where: { id: userId },
      data: { refresh_token: null },
    });

    return { message: 'Déconnexion effectuée avec succès.' };
  }

  private async generateTokens(payload: JwtPayload): Promise<AuthTokens> {
    const [access_token, refresh_token] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.jwtAccessSecret,
        expiresIn: '15m',
      }),
      this.jwtService.signAsync(payload, {
        secret: this.jwtRefreshSecret,
        expiresIn: '7d',
      }),
    ]);

    return {
      access_token,
      refresh_token,
      expires_in: 15 * 60, // 15 minutes en secondes
    };
  }

  private async updateRefreshToken(userId: string, refreshToken: string): Promise<void> {
    const hashedRefreshToken = await argon2.hash(refreshToken, {
      type: argon2.argon2id,
    });

    await this.prisma.users.update({
      where: { id: userId },
      data: { refresh_token: hashedRefreshToken },
    });
  }
}
