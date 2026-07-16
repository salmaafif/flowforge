import { z } from 'zod';

export const loginSchema = z.object({
  tenantSlug: z.string().min(1).max(100),
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
});

export type LoginDto = z.infer<typeof loginSchema>;
