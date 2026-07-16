import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const schema = z.object({ name: z.string().min(1), count: z.number().int() });
  const pipe = new ZodValidationPipe(schema);

  it('returns the parsed, typed value for valid input', () => {
    expect(pipe.transform({ name: 'wf', count: 2 })).toEqual({ name: 'wf', count: 2 });
  });

  it('strips unknown properties', () => {
    expect(pipe.transform({ name: 'wf', count: 2, extra: 'x' })).toEqual({ name: 'wf', count: 2 });
  });

  it('throws a BadRequestException listing each invalid field', () => {
    try {
      pipe.transform({ name: '', count: 'not-a-number' });
      fail('Expected the pipe to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        issues: Array<{ path: string }>;
      };
      expect(response.issues.map((issue) => issue.path)).toEqual(
        expect.arrayContaining(['name', 'count']),
      );
    }
  });
});
