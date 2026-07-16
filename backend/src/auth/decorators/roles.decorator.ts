import { CustomDecorator, SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Declares the minimum role required for a route (or controller). Roles are
 * hierarchical — ADMIN satisfies an EDITOR requirement, EDITOR satisfies VIEWER —
 * so listing one role is enough: @Roles(Role.EDITOR) allows editors and admins.
 */
export const Roles = (...roles: Role[]): CustomDecorator => SetMetadata(ROLES_KEY, roles);
