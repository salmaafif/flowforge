import { z } from 'zod';

/**
 * Zod schema for a workflow's DAG definition. This is the single source of truth
 * for the JSON stored in WorkflowVersion.definition; the inferred types below are
 * used throughout the engine so runtime validation and compile-time types cannot
 * drift apart.
 *
 * Structural validation only (shapes, ranges, referential integrity between steps).
 * Acyclicity is enforced by the topological sort in the next step.
 */

const stepKeySchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/, 'Step key may only contain letters, numbers, "_" and "-"');

const retryBackoffSchema = z.object({
  strategy: z.enum(['fixed', 'exponential']),
  initialDelayMs: z.number().int().nonnegative(),
  factor: z.number().min(1).optional(),
  maxDelayMs: z.number().int().positive().optional(),
});

const retryPolicySchema = z.object({
  maxRetries: z.number().int().min(0).max(20),
  backoff: retryBackoffSchema,
});

// Fields shared by every step type.
const baseStepFields = {
  key: stepKeySchema,
  name: z.string().min(1),
  dependsOn: z.array(stepKeySchema).default([]),
  retry: retryPolicySchema.optional(),
};

const httpStepSchema = z.object({
  ...baseStepFields,
  type: z.literal('HTTP'),
  config: z.object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    url: z.string().url(),
    headers: z.record(z.string()).optional(),
    body: z.unknown().optional(),
    timeoutMs: z.number().int().positive().optional(),
  }),
});

const scriptStepSchema = z.object({
  ...baseStepFields,
  type: z.literal('SCRIPT'),
  config: z.object({
    code: z.string().min(1),
  }),
});

const delayStepSchema = z.object({
  ...baseStepFields,
  type: z.literal('DELAY'),
  config: z.object({
    delayMs: z.number().int().positive(),
  }),
});

const conditionStepSchema = z.object({
  ...baseStepFields,
  type: z.literal('CONDITION'),
  config: z.object({
    expression: z.string().min(1),
  }),
});

export const workflowStepSchema = z.discriminatedUnion('type', [
  httpStepSchema,
  scriptStepSchema,
  delayStepSchema,
  conditionStepSchema,
]);

export const workflowDefinitionSchema = z
  .object({
    // Global workflow timeout; omitted means "no explicit limit".
    timeoutMs: z.number().int().positive().optional(),
    steps: z.array(workflowStepSchema).min(1),
  })
  .superRefine((definition, ctx) => {
    const seenKeys = new Set<string>();

    definition.steps.forEach((step, stepIndex) => {
      if (seenKeys.has(step.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate step key "${step.key}"`,
          path: ['steps', stepIndex, 'key'],
        });
      }
      seenKeys.add(step.key);
    });

    const knownKeys = new Set(definition.steps.map((step) => step.key));

    definition.steps.forEach((step, stepIndex) => {
      step.dependsOn.forEach((dependencyKey, depIndex) => {
        if (dependencyKey === step.key) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Step "${step.key}" cannot depend on itself`,
            path: ['steps', stepIndex, 'dependsOn', depIndex],
          });
        } else if (!knownKeys.has(dependencyKey)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Step "${step.key}" depends on unknown step "${dependencyKey}"`,
            path: ['steps', stepIndex, 'dependsOn', depIndex],
          });
        }
      });
    });
  });

export type RetryPolicy = z.infer<typeof retryPolicySchema>;
export type WorkflowStep = z.infer<typeof workflowStepSchema>;
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type StepType = WorkflowStep['type'];
