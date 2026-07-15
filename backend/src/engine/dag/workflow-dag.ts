import { CyclicWorkflowError } from './errors';
import { WorkflowDefinition, WorkflowStep } from './workflow-definition.schema';

/**
 * In-memory representation of a validated workflow definition as a directed acyclic
 * graph. Responsible for turning the dependency declarations (`dependsOn`) into a
 * concrete execution plan and for rejecting graphs that contain a cycle.
 *
 * Edge direction: a prerequisite points to the steps that depend on it, so a step's
 * in-degree equals the number of dependencies it is still waiting on.
 */
export class WorkflowDag {
  private readonly stepsByKey = new Map<string, WorkflowStep>();
  /** step key -> keys it depends on (its prerequisites). */
  private readonly dependencies = new Map<string, string[]>();
  /** step key -> keys that depend on it (its successors). */
  private readonly dependents = new Map<string, string[]>();

  constructor(definition: WorkflowDefinition) {
    for (const step of definition.steps) {
      this.stepsByKey.set(step.key, step);
      this.dependencies.set(step.key, [...step.dependsOn]);
      this.dependents.set(step.key, []);
    }

    for (const step of definition.steps) {
      for (const dependencyKey of step.dependsOn) {
        this.dependents.get(dependencyKey)?.push(step.key);
      }
    }
  }

  get size(): number {
    return this.stepsByKey.size;
  }

  get steps(): WorkflowStep[] {
    return [...this.stepsByKey.values()];
  }

  getStep(key: string): WorkflowStep | undefined {
    return this.stepsByKey.get(key);
  }

  dependenciesOf(key: string): string[] {
    return [...(this.dependencies.get(key) ?? [])];
  }

  dependentsOf(key: string): string[] {
    return [...(this.dependents.get(key) ?? [])];
  }

  /**
   * Flat topological ordering of step keys. Every step appears after all of its
   * dependencies.
   *
   * @throws CyclicWorkflowError when the graph contains a cycle.
   */
  topologicalOrder(): string[] {
    return this.executionLevels().flat();
  }

  /**
   * Groups steps into ordered levels using Kahn's algorithm. Every step in a level
   * depends only on steps in earlier levels, so all steps within a level are
   * independent and may be executed in parallel.
   *
   * @throws CyclicWorkflowError when the graph contains a cycle.
   */
  executionLevels(): string[][] {
    const remainingInDegree = new Map<string, number>();
    for (const [key, deps] of this.dependencies) {
      remainingInDegree.set(key, deps.length);
    }

    let frontier = this.sortedKeysWithZeroInDegree(remainingInDegree);
    const levels: string[][] = [];
    let processedCount = 0;

    while (frontier.length > 0) {
      levels.push(frontier);
      const nextFrontier: string[] = [];

      for (const key of frontier) {
        processedCount += 1;
        for (const dependent of this.dependents.get(key) ?? []) {
          const updated = (remainingInDegree.get(dependent) ?? 0) - 1;
          remainingInDegree.set(dependent, updated);
          if (updated === 0) {
            nextFrontier.push(dependent);
          }
        }
      }

      frontier = nextFrontier.sort();
    }

    if (processedCount !== this.stepsByKey.size) {
      throw new CyclicWorkflowError(this.findCycle());
    }

    return levels;
  }

  private sortedKeysWithZeroInDegree(inDegree: Map<string, number>): string[] {
    return [...inDegree.entries()]
      .filter(([, degree]) => degree === 0)
      .map(([key]) => key)
      .sort();
  }

  /**
   * Depth-first search that returns the keys forming one cycle. Only called once a
   * cycle is known to exist, so it always finds one.
   */
  private findCycle(): string[] {
    const enum Color {
      White,
      Gray,
      Black,
    }
    const color = new Map<string, Color>();
    for (const key of this.stepsByKey.keys()) {
      color.set(key, Color.White);
    }
    const path: string[] = [];

    const visit = (key: string): string[] | null => {
      color.set(key, Color.Gray);
      path.push(key);

      for (const dependencyKey of this.dependencies.get(key) ?? []) {
        if (color.get(dependencyKey) === Color.Gray) {
          const start = path.indexOf(dependencyKey);
          return [...path.slice(start), dependencyKey];
        }
        if (color.get(dependencyKey) === Color.White) {
          const found = visit(dependencyKey);
          if (found) {
            return found;
          }
        }
      }

      color.set(key, Color.Black);
      path.pop();
      return null;
    };

    for (const key of this.stepsByKey.keys()) {
      if (color.get(key) === Color.White) {
        const found = visit(key);
        if (found) {
          return found;
        }
      }
    }

    return [];
  }
}
