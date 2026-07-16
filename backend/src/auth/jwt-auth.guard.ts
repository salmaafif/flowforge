import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import { AuthenticatedUser, JwtPayload, RequestWithUser } from './auth.types';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';

/**
 * Global authentication guard. Every route requires a valid Bearer token unless it
 * (or its controller) is marked with @Public(). On success the decoded principal is
 * attached to the request for @CurrentUser() and the tenant-isolation layer.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      request.user = this.toAuthenticatedUser(payload);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    return true;
  }

  private extractBearerToken(request: RequestWithUser): string | undefined {
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme === 'Bearer' && token) {
      return token;
    }
    // Fallback for SSE: the browser's EventSource API cannot set headers, so the
    // dashboard passes ?access_token=. Trade-off: tokens can end up in access logs;
    // acceptable for short-lived JWTs here, avoidable with cookie auth later.
    const queryToken = (request.query as Record<string, unknown> | undefined)?.access_token;
    return typeof queryToken === 'string' && queryToken.length > 0 ? queryToken : undefined;
  }

  private toAuthenticatedUser(payload: JwtPayload): AuthenticatedUser {
    return {
      userId: payload.sub,
      tenantId: payload.tenantId,
      email: payload.email,
      role: payload.role,
    };
  }
}
