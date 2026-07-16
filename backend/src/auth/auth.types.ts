import { Role } from '@prisma/client';
import { Request } from 'express';

/** Claims embedded in every access token. */
export interface JwtPayload {
  /** User id. */
  sub: string;
  tenantId: string;
  email: string;
  role: Role;
}

/** The authenticated principal attached to each request by JwtAuthGuard. */
export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  email: string;
  role: Role;
}

export interface RequestWithUser extends Request {
  user?: AuthenticatedUser;
}

export interface LoginResult {
  accessToken: string;
  user: AuthenticatedUser;
}
