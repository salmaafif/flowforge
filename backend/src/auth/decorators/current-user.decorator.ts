import { ExecutionContext, createParamDecorator } from '@nestjs/common';

import { AuthenticatedUser, RequestWithUser } from '../auth.types';

/** Injects the authenticated principal that JwtAuthGuard attached to the request. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser | undefined => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    return request.user;
  },
);
