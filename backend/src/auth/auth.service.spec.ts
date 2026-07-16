import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const tenant = { id: 'tenant-1', slug: 'acme' };
  const passwordHash = bcrypt.hashSync('correct-password', 4);
  const user = {
    id: 'user-1',
    tenantId: tenant.id,
    email: 'admin@acme.test',
    passwordHash,
    role: Role.ADMIN,
  };

  const prismaMock = {
    tenant: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
  };
  const jwtMock = { signAsync: jest.fn().mockResolvedValue('signed-token') };

  const service = new AuthService(
    prismaMock as unknown as PrismaService,
    jwtMock as unknown as JwtService,
  );

  const credentials = {
    tenantSlug: 'acme',
    email: 'admin@acme.test',
    password: 'correct-password',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.tenant.findUnique.mockResolvedValue(tenant);
    prismaMock.user.findUnique.mockResolvedValue(user);
  });

  it('returns a token and the principal on valid credentials', async () => {
    const result = await service.login(credentials);

    expect(result.accessToken).toBe('signed-token');
    expect(result.user).toEqual({
      userId: 'user-1',
      tenantId: 'tenant-1',
      email: 'admin@acme.test',
      role: Role.ADMIN,
    });
    expect(jwtMock.signAsync).toHaveBeenCalledWith({
      sub: 'user-1',
      tenantId: 'tenant-1',
      email: 'admin@acme.test',
      role: Role.ADMIN,
    });
  });

  it('rejects a wrong password', async () => {
    await expect(service.login({ ...credentials, password: 'wrong' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an unknown tenant with the same error', async () => {
    prismaMock.tenant.findUnique.mockResolvedValue(null);
    await expect(service.login(credentials)).rejects.toThrow('Invalid credentials');
  });

  it('rejects an unknown user with the same error', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(service.login(credentials)).rejects.toThrow('Invalid credentials');
  });

  it('scopes the user lookup to the tenant', async () => {
    await service.login(credentials);
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { tenantId_email: { tenantId: 'tenant-1', email: 'admin@acme.test' } },
    });
  });
});
