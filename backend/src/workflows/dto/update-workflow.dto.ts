import { z } from 'zod';

import { cronExpressionSchema } from './create-workflow.dto';

export const updateWorkflowSchema = z
  .object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).nullable(),
    enabled: z.boolean(),
    cronExpression: cronExpressionSchema.nullable(),
  })
  .partial()
  .refine((dto) => Object.keys(dto).length > 0, { message: 'At least one field is required' });

export type UpdateWorkflowDto = z.infer<typeof updateWorkflowSchema>;
