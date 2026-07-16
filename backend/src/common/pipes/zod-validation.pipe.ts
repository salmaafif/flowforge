import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { ZodTypeAny, z } from 'zod';

/**
 * Validates and parses an incoming payload against a Zod schema. Invalid input is
 * rejected with a 400 that lists each offending field, and — because Zod strips or
 * rejects unknown shapes — what reaches the handler is exactly the typed DTO.
 */
@Injectable()
export class ZodValidationPipe<TSchema extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.infer<TSchema> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
