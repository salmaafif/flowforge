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
