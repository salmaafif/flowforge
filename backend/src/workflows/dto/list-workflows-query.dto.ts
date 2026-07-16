import { z } from 'zod';

import { paginationQuerySchema } from '../../common/pagination';

export const listWorkflowsQuerySchema = paginationQuerySchema.extend({
  /** Case-insensitive substring match on the workflow name. */
  search: z.string().min(1).max(100).optional(),
  enabled: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export type ListWorkflowsQueryDto = z.infer<typeof listWorkflowsQuerySchema>;
