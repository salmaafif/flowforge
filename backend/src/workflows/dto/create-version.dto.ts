import { z } from 'zod';

import { workflowDefinitionSchema } from '../../engine/dag/workflow-definition.schema';

export const createVersionSchema = z.object({
  definition: workflowDefinitionSchema,
});

export type CreateVersionDto = z.infer<typeof createVersionSchema>;
