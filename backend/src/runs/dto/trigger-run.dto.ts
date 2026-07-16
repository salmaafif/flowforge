import { z } from 'zod';

export const triggerRunSchema = z.object({
  /** Optional trigger payload, exposed to steps as `outputs.$input`. */
  input: z.unknown().optional(),
});

export type TriggerRunDto = z.infer<typeof triggerRunSchema>;
