import { z } from 'zod';

export const generateWorkflowSchema = z.object({
  /** Plain-English description of the workflow to generate. */
  prompt: z.string().min(1).max(2000),
});

export type GenerateWorkflowDto = z.infer<typeof generateWorkflowSchema>;
