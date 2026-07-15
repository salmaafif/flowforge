import { CyclicWorkflowError } from './errors';
import { WorkflowDefinition } from './workflow-definition.schema';
import { WorkflowDefinitionValidator } from './workflow-definition.validator';
import { WorkflowDag } from './workflow-dag';

const validator = new WorkflowDefinitionValidator();

/** Builds a validated DAG from simple DELAY steps described as `key -> dependsOn`. */
function buildDag(steps: Array<{ key: string; dependsOn?: string[] }>): WorkflowDag {
  const definition: WorkflowDefinition = validator.validate({
    steps: steps.map((step) => ({
      key: step.key,
      name: step.key.toUpperCase(),
      type: 'DELAY',
      dependsOn: step.dependsOn ?? [],
      config: { delayMs: 10 },
    })),
  });
  return new WorkflowDag(definition);
}

describe('WorkflowDag', () => {
  describe('executionLevels / topologicalOrder', () => {
    it('orders a linear chain sequentially', () => {
      const dag = buildDag([
        { key: 'a' },
        { key: 'b', dependsOn: ['a'] },
        { key: 'c', dependsOn: ['b'] },
      ]);

      expect(dag.executionLevels()).toEqual([['a'], ['b'], ['c']]);
      expect(dag.topologicalOrder()).toEqual(['a', 'b', 'c']);
    });

    it('groups independent steps into the same parallel level', () => {
      const dag = buildDag([{ key: 'a' }, { key: 'b' }, { key: 'c', dependsOn: ['a', 'b'] }]);

      expect(dag.executionLevels()).toEqual([['a', 'b'], ['c']]);
    });

    it('handles a diamond dependency', () => {
      const dag = buildDag([
        { key: 'a' },
        { key: 'b', dependsOn: ['a'] },
        { key: 'c', dependsOn: ['a'] },
        { key: 'd', dependsOn: ['b', 'c'] },
      ]);

      expect(dag.executionLevels()).toEqual([['a'], ['b', 'c'], ['d']]);
      expect(dag.topologicalOrder()).toEqual(['a', 'b', 'c', 'd']);
    });

    it('places every step after all of its dependencies', () => {
      const dag = buildDag([
        { key: 'd', dependsOn: ['b', 'c'] },
        { key: 'b', dependsOn: ['a'] },
        { key: 'c', dependsOn: ['a'] },
        { key: 'a' },
      ]);

      const order = dag.topologicalOrder();
      const position = (key: string): number => order.indexOf(key);
      expect(position('a')).toBeLessThan(position('b'));
      expect(position('a')).toBeLessThan(position('c'));
      expect(position('b')).toBeLessThan(position('d'));
      expect(position('c')).toBeLessThan(position('d'));
    });

    it('handles a single step', () => {
      const dag = buildDag([{ key: 'only' }]);
      expect(dag.executionLevels()).toEqual([['only']]);
    });
  });

  describe('cycle detection', () => {
    it('throws on a two-node cycle', () => {
      const dag = buildDag([
        { key: 'a', dependsOn: ['b'] },
        { key: 'b', dependsOn: ['a'] },
      ]);

      expect(() => dag.executionLevels()).toThrow(CyclicWorkflowError);
    });

    it('reports the keys involved in the cycle', () => {
      const dag = buildDag([
        { key: 'a', dependsOn: ['c'] },
        { key: 'b', dependsOn: ['a'] },
        { key: 'c', dependsOn: ['b'] },
      ]);

      try {
        dag.topologicalOrder();
        fail('Expected a CyclicWorkflowError');
      } catch (error) {
        expect(error).toBeInstanceOf(CyclicWorkflowError);
        expect((error as CyclicWorkflowError).cycle).toEqual(
          expect.arrayContaining(['a', 'b', 'c']),
        );
      }
    });
  });

  describe('graph accessors', () => {
    const dag = buildDag([
      { key: 'a' },
      { key: 'b', dependsOn: ['a'] },
      { key: 'c', dependsOn: ['a'] },
    ]);

    it('exposes size and steps', () => {
      expect(dag.size).toBe(3);
      expect(dag.steps.map((step) => step.key).sort()).toEqual(['a', 'b', 'c']);
    });

    it('returns dependencies and dependents', () => {
      expect(dag.dependenciesOf('b')).toEqual(['a']);
      expect(dag.dependentsOf('a').sort()).toEqual(['b', 'c']);
    });

    it('returns the step by key', () => {
      expect(dag.getStep('a')?.name).toBe('A');
      expect(dag.getStep('missing')).toBeUndefined();
    });
  });
});
