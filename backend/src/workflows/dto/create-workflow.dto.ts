import { z } from 'zod';

import { isValidCronExpression } from '../../common/cron';
import { workflowDefinitionSchema } from '../../engine/dag/workflow-definition.schema';

export const cronExpressionSchema = z
  .string()
  .min(1)
  .max(100)
  .refine(isValidCronExpression, { message: 'Invalid cron expression' });

export const createWorkflowSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  cronExpression: cronExpressionSchema.optional(),
  definition: workflowDefinitionSchema,
});

export type CreateWorkflowDto = z.infer<typeof createWorkflowSchema>;
