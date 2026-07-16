import { Background, ReactFlow } from '@xyflow/react';
import type { Edge, Node } from '@xyflow/react';
import { useMemo } from 'react';
import '@xyflow/react/dist/style.css';

import type { DefinitionStep, StepStatus } from '../api/types';

const NODE_COLORS: Record<StepStatus, { border: string; background: string }> = {
  PENDING: { border: '#475569', background: '#0f172a' },
  RUNNING: { border: '#38bdf8', background: '#082f49' },
  RETRYING: { border: '#a78bfa', background: '#2e1065' },
  SUCCEEDED: { border: '#34d399', background: '#022c22' },
  FAILED: { border: '#f87171', background: '#450a0a' },
  SKIPPED: { border: '#fbbf24', background: '#451a03' },
};

const LEVEL_GAP_X = 240;
const NODE_GAP_Y = 90;

/**
 * Assigns each step a column equal to its depth in the dependency graph (same
 * levelling the engine uses for parallel execution), so the graph reads
 * left-to-right in execution order without an external layout library.
 */
function computeLevels(steps: DefinitionStep[]): Map<string, number> {
  const byKey = new Map(steps.map((step) => [step.key, step]));
  const levels = new Map<string, number>();

  const levelOf = (key: string): number => {
    const known = levels.get(key);
    if (known !== undefined) {
      return known;
    }
    const dependsOn = byKey.get(key)?.dependsOn ?? [];
    const level =
      dependsOn.length === 0 ? 0 : 1 + Math.max(...dependsOn.map((dep) => levelOf(dep)));
    levels.set(key, level);
    return level;
  };

  steps.forEach((step) => levelOf(step.key));
  return levels;
}

interface DagViewProps {
  steps: DefinitionStep[];
  /** Live status per step key; missing keys render as PENDING. */
  statusByKey: Record<string, StepStatus>;
}

/** Read-only DAG rendering of a workflow definition, coloured by live step status. */
export function DagView({ steps, statusByKey }: DagViewProps) {
  const { nodes, edges } = useMemo(() => {
    const levels = computeLevels(steps);
    const countPerLevel = new Map<number, number>();

    const nodes: Node[] = steps.map((step) => {
      const level = levels.get(step.key) ?? 0;
      const row = countPerLevel.get(level) ?? 0;
      countPerLevel.set(level, row + 1);
      const status = statusByKey[step.key] ?? 'PENDING';
      const colors = NODE_COLORS[status];

      return {
        id: step.key,
        position: { x: level * LEVEL_GAP_X, y: row * NODE_GAP_Y },
        data: { label: `${step.name} (${step.type})` },
        sourcePosition: 'right',
        targetPosition: 'left',
        // Explicit dimensions + handle positions mark the node as pre-measured, so
        // nodes AND edges render immediately (and reliably in headless/SSR
        // environments where ResizeObserver may never fire).
        width: 170,
        height: 44,
        handles: [
          { type: 'source', position: 'right', x: 170, y: 22, width: 6, height: 6 },
          { type: 'target', position: 'left', x: 0, y: 22, width: 6, height: 6 },
        ],
        style: {
          border: `2px solid ${colors.border}`,
          background: colors.background,
          color: '#e2e8f0',
          borderRadius: 10,
          fontSize: 12,
          padding: 8,
          width: 170,
        },
      } as Node;
    });

    const edges: Edge[] = steps.flatMap((step) =>
      (step.dependsOn ?? []).map((dep) => ({
        id: `${dep}->${step.key}`,
        source: dep,
        target: step.key,
        animated: (statusByKey[step.key] ?? 'PENDING') === 'RUNNING',
        style: { stroke: '#475569' },
      })),
    );

    return { nodes, edges };
  }, [steps, statusByKey]);

  return (
    <div className="h-72 rounded-xl border border-slate-800 bg-slate-900/30">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#1e293b" gap={20} />
      </ReactFlow>
    </div>
  );
}
