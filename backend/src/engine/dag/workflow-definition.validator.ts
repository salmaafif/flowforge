import { InvalidWorkflowDefinitionError } from './errors';
import { WorkflowDefinition, workflowDefinitionSchema } from './workflow-definition.schema';

/**
 * Validates and parses untrusted input into a typed WorkflowDefinition.
 * Keeping this behind a class lets the rest of the engine (and the API layer)
 * depend on a small, stable interface rather than on Zod directly.
 */
export class WorkflowDefinitionValidator {
  /**
   * @throws InvalidWorkflowDefinitionError when the input is not a valid definition.
   */
  validate(input: unknown): WorkflowDefinition {
    const result = workflowDefinitionSchema.safeParse(input);
    if (!result.success) {
      throw InvalidWorkflowDefinitionError.fromZodError(result.error);
    }
    return result.data;
  }

  /** Non-throwing variant for callers that prefer to branch on the outcome. */
  isValid(input: unknown): boolean {
    return workflowDefinitionSchema.safeParse(input).success;
  }
}
