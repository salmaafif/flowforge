import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload, LoginResult } from './auth.types';
import { LoginDto } from './dto/login.dto';

/**
 * Verifies tenant-scoped credentials and issues access tokens. Every failure mode
 * (unknown tenant, unknown user, wrong password) returns the same 401 so callers
 * cannot probe which part was wrong.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(credentials: LoginDto): Promise<LoginResult> {
    const user = await this.findUser(credentials.tenantSlug, credentials.email);
    const passwordMatches =
      user !== null && (await bcrypt.compare(credentials.password, user.passwordHash));

    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      user: {
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
        role: user.role,
      },
    };
  }

  private async findUser(tenantSlug: string, email: string): Promise<User | null> {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug: tenantSlug } });
    if (!tenant) {
      return null;
    }
    return this.prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email } },
    });
  }
}
