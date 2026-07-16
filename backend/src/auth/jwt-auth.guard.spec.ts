import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';

import { JwtPayload, RequestWithUser } from './auth.types';
import { JwtAuthGuard } from './jwt-auth.guard';

const payload: JwtPayload = {
  sub: 'user-1',
  tenantId: 'tenant-1',
  email: 'admin@acme.test',
  role: Role.ADMIN,
};

describe('JwtAuthGuard', () => {
  const jwtMock = { verifyAsync: jest.fn() };
  const reflectorMock = { getAllAndOverride: jest.fn() };
  const guard = new JwtAuthGuard(
    jwtMock as unknown as JwtService,
    reflectorMock as unknown as Reflector,
  );

  const createContext = (
    authorization?: string,
    query: Record<string, unknown> = {},
  ): { context: ExecutionContext; request: RequestWithUser } => {
    const request = { headers: { authorization }, query } as unknown as RequestWithUser;
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    reflectorMock.getAllAndOverride.mockReturnValue(false);
  });

  it('allows a @Public route without a token', async () => {
    reflectorMock.getAllAndOverride.mockReturnValue(true);
    const { context } = createContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwtMock.verifyAsync).not.toHaveBeenCalled();
  });

  it('rejects a missing bearer token', async () => {
    const { context } = createContext();
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a malformed authorization header', async () => {
    const { context } = createContext('Basic abc123');
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an invalid or expired token', async () => {
    jwtMock.verifyAsync.mockRejectedValue(new Error('jwt expired'));
    const { context } = createContext('Bearer bad-token');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches the principal to the request on a valid token', async () => {
    jwtMock.verifyAsync.mockResolvedValue(payload);
    const { context, request } = createContext('Bearer good-token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({
      userId: 'user-1',
      tenantId: 'tenant-1',
      email: 'admin@acme.test',
      role: Role.ADMIN,
    });
  });

  it('accepts ?access_token= as a fallback (SSE/EventSource cannot set headers)', async () => {
    jwtMock.verifyAsync.mockResolvedValue(payload);
    const { context, request } = createContext(undefined, { access_token: 'query-token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwtMock.verifyAsync).toHaveBeenCalledWith('query-token');
    expect(request.user?.tenantId).toBe('tenant-1');
  });
});
