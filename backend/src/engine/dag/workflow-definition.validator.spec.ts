import { InvalidWorkflowDefinitionError } from './errors';
import { WorkflowDefinition } from './workflow-definition.schema';
import { WorkflowDefinitionValidator } from './workflow-definition.validator';

describe('WorkflowDefinitionValidator', () => {
  const validator = new WorkflowDefinitionValidator();

  const validDefinition = {
    timeoutMs: 60_000,
    steps: [
      {
        key: 'fetch',
        name: 'Fetch data',
        type: 'HTTP',
        dependsOn: [],
        config: { method: 'GET', url: 'https://example.com/api' },
        retry: {
          maxRetries: 3,
          backoff: { strategy: 'exponential', initialDelayMs: 500, factor: 2 },
        },
      },
      {
        key: 'process',
        name: 'Process data',
        type: 'SCRIPT',
        dependsOn: ['fetch'],
        config: { code: 'return input;' },
      },
      {
        key: 'check',
        name: 'Has results?',
        type: 'CONDITION',
        dependsOn: ['process'],
        config: { expression: 'output.length > 0' },
      },
      {
        key: 'cooldown',
        name: 'Cooldown',
        type: 'DELAY',
        dependsOn: ['check'],
        config: { delayMs: 1000 },
      },
    ],
  };

  describe('valid definitions', () => {
    it('accepts a well-formed multi-type DAG', () => {
      const result: WorkflowDefinition = validator.validate(validDefinition);
      expect(result.steps).toHaveLength(4);
      expect(result.steps[0].type).toBe('HTTP');
    });

    it('defaults dependsOn to an empty array when omitted', () => {
      const result = validator.validate({
        steps: [{ key: 'a', name: 'A', type: 'DELAY', config: { delayMs: 10 } }],
      });
      expect(result.steps[0].dependsOn).toEqual([]);
    });

    it('isValid returns true for a valid definition', () => {
      expect(validator.isValid(validDefinition)).toBe(true);
    });
  });

  describe('invalid definitions', () => {
    const expectIssue = (input: unknown, partialMessage: string): void => {
      try {
        validator.validate(input);
        fail('Expected validation to throw');
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidWorkflowDefinitionError);
        const messages = (error as InvalidWorkflowDefinitionError).issues
          .map((issue) => issue.message)
          .join(' ');
        expect(messages).toContain(partialMessage);
      }
    };

    it('rejects an empty step list', () => {
      expect(() => validator.validate({ steps: [] })).toThrow(InvalidWorkflowDefinitionError);
    });

    it('rejects duplicate step keys', () => {
      expectIssue(
        {
          steps: [
            { key: 'a', name: 'A', type: 'DELAY', config: { delayMs: 10 } },
            { key: 'a', name: 'A2', type: 'DELAY', config: { delayMs: 10 } },
          ],
        },
        'Duplicate step key',
      );
    });

    it('rejects a dependency on an unknown step', () => {
      expectIssue(
        {
          steps: [
            { key: 'a', name: 'A', type: 'DELAY', dependsOn: ['ghost'], config: { delayMs: 10 } },
          ],
        },
        'unknown step',
      );
    });

    it('rejects a self-dependency', () => {
      expectIssue(
        {
          steps: [
            { key: 'a', name: 'A', type: 'DELAY', dependsOn: ['a'], config: { delayMs: 10 } },
          ],
        },
        'cannot depend on itself',
      );
    });

    it('rejects an unknown step type', () => {
      expect(() =>
        validator.validate({
          steps: [{ key: 'a', name: 'A', type: 'EMAIL', config: {} }],
        }),
      ).toThrow(InvalidWorkflowDefinitionError);
    });

    it('rejects an HTTP step with an invalid url', () => {
      expect(() =>
        validator.validate({
          steps: [
            { key: 'a', name: 'A', type: 'HTTP', config: { method: 'GET', url: 'not-a-url' } },
          ],
        }),
      ).toThrow(InvalidWorkflowDefinitionError);
    });

    it('rejects a DELAY step with a non-positive delay', () => {
      expect(() =>
        validator.validate({
          steps: [{ key: 'a', name: 'A', type: 'DELAY', config: { delayMs: 0 } }],
        }),
      ).toThrow(InvalidWorkflowDefinitionError);
    });

    it('isValid returns false instead of throwing', () => {
      expect(validator.isValid({ steps: [] })).toBe(false);
    });
  });
});
