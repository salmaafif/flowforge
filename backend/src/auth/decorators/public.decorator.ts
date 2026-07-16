import { CustomDecorator, SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marks a route (or controller) as reachable without a JWT. */
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_KEY, true);
