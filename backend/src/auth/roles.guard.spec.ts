import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';

import { AuthenticatedUser } from './auth.types';
import { RolesGuard } from './roles.guard';

const principal = (role: Role): AuthenticatedUser => ({
  userId: 'user-1',
  tenantId: 'tenant-1',
  email: 'someone@salma.test',
  role,
});

describe('RolesGuard', () => {
  const reflectorMock = { getAllAndOverride: jest.fn() };
  const guard = new RolesGuard(reflectorMock as unknown as Reflector);

  const createContext = (user?: AuthenticatedUser): ExecutionContext =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  beforeEach(() => jest.clearAllMocks());

  it('allows any authenticated user when no roles are required', () => {
    reflectorMock.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(createContext(principal(Role.VIEWER)))).toBe(true);
  });

  it('denies a viewer on an editor-only route', () => {
    reflectorMock.getAllAndOverride.mockReturnValue([Role.EDITOR]);
    expect(() => guard.canActivate(createContext(principal(Role.VIEWER)))).toThrow(
      ForbiddenException,
    );
  });

  it('allows an editor on an editor-only route', () => {
    reflectorMock.getAllAndOverride.mockReturnValue([Role.EDITOR]);
    expect(guard.canActivate(createContext(principal(Role.EDITOR)))).toBe(true);
  });

  it('allows an admin on an editor-only route (hierarchy)', () => {
    reflectorMock.getAllAndOverride.mockReturnValue([Role.EDITOR]);
    expect(guard.canActivate(createContext(principal(Role.ADMIN)))).toBe(true);
  });

  it('denies an editor on an admin-only route', () => {
    reflectorMock.getAllAndOverride.mockReturnValue([Role.ADMIN]);
    expect(() => guard.canActivate(createContext(principal(Role.EDITOR)))).toThrow(
      ForbiddenException,
    );
  });

  it('denies when roles are required but no principal is attached', () => {
    reflectorMock.getAllAndOverride.mockReturnValue([Role.VIEWER]);
    expect(() => guard.canActivate(createContext(undefined))).toThrow(ForbiddenException);
  });
});
