import { z } from 'zod';

import { workflowDefinitionSchema } from '../../engine/dag/workflow-definition.schema';

export const createWorkflowSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  // Cron format is validated properly in the scheduling step (6c).
  cronExpression: z.string().min(1).max(100).optional(),
  definition: workflowDefinitionSchema,
});

export type CreateWorkflowDto = z.infer<typeof createWorkflowSchema>;
