import { ZodError } from 'zod';

export interface WorkflowDefinitionIssue {
  path: string;
  message: string;
}

/**
 * Domain error thrown when a workflow definition fails validation. Wraps Zod's
 * low-level issues in a stable, transport-friendly shape the API layer can return.
 */
export class InvalidWorkflowDefinitionError extends Error {
  constructor(readonly issues: WorkflowDefinitionIssue[]) {
    super(
      `Invalid workflow definition: ${issues
        .map((issue) => `${issue.path || '(root)'} — ${issue.message}`)
        .join('; ')}`,
    );
    this.name = 'InvalidWorkflowDefinitionError';
  }

  static fromZodError(error: ZodError): InvalidWorkflowDefinitionError {
    return new InvalidWorkflowDefinitionError(
      error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
}

/**
 * Thrown when a definition is structurally valid but its dependency graph contains
 * a cycle, so no topological execution order exists.
 */
export class CyclicWorkflowError extends Error {
  constructor(readonly cycle: string[]) {
    super(`Workflow graph contains a cycle: ${cycle.join(' -> ')}`);
    this.name = 'CyclicWorkflowError';
  }
}
