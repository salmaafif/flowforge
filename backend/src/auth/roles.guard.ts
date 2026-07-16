import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';

import { RequestWithUser } from './auth.types';
import { ROLES_KEY } from './decorators/roles.decorator';

/** Higher rank ⇒ more privileges. */
const ROLE_RANK: Record<Role, number> = {
  [Role.VIEWER]: 1,
  [Role.EDITOR]: 2,
  [Role.ADMIN]: 3,
};

/**
 * Role-based access control. Runs after JwtAuthGuard (registration order), so the
 * request already carries the authenticated principal. A route without @Roles()
 * only requires authentication; with @Roles(...), the user's role must rank at
 * least as high as the weakest role listed.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<RequestWithUser>();
    if (!user) {
      throw new ForbiddenException('Insufficient permissions');
    }

    const requiredRank = Math.min(...requiredRoles.map((role) => ROLE_RANK[role]));
    if (ROLE_RANK[user.role] < requiredRank) {
      throw new ForbiddenException('Insufficient permissions');
    }
    return true;
  }
}
