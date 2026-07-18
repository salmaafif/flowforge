import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import {
  createWorkflow,
  createWorkflowVersion,
  generateWorkflow,
  getWorkflow,
  getWorkflowVersion,
  listWorkflowVersions,
  updateWorkflow,
  rollbackWorkflowVersion,
} from '../api/workflows';
import type { DefinitionStep, WorkflowVersionSummary } from '../api/types';
import { AppLayout } from '../components/AppLayout';
import { DagView } from '../components/DagView';

const TEMPLATE = `{
  "timeoutMs": 60000,
  "steps": [
    {
      "key": "fetch",
      "name": "Fetch data",
      "type": "HTTP",
      "dependsOn": [],
      "config": { "method": "GET", "url": "https://example.com/api" }
    },
    {
      "key": "process",
      "name": "Process",
      "type": "SCRIPT",
      "dependsOn": ["fetch"],
      "config": { "code": "return input.fetch;" }
    }
  ]
}`;

const STEP_TYPES = ['HTTP', 'SCRIPT', 'DELAY', 'CONDITION'];

interface ParseResult {
  ok: boolean;
  error?: string;
  definition?: unknown;
  steps?: DefinitionStep[];
}

/** Lightweight client-side check that mirrors the server's structural rules. */
function parseDefinition(raw: string): ParseResult {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch (error) {
    return { ok: false, error: `Invalid JSON: ${(error as Error).message}` };
  }
  const steps = (obj as { steps?: unknown })?.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    return { ok: false, error: 'Definition needs a non-empty "steps" array.' };
  }
  const typed = steps as Array<Record<string, unknown>>;
  for (const step of typed) {
    if (!step.key || !step.name || !STEP_TYPES.includes(step.type as string)) {
      return {
        ok: false,
        error: 'Each step needs key, name, and a valid type (HTTP/SCRIPT/DELAY/CONDITION).',
      };
    }
  }
  const keys = typed.map((step) => step.key as string);
  const duplicate = keys.find((key, index) => keys.indexOf(key) !== index);
  if (duplicate) {
    return {
      ok: false,
      error: `Duplicate step key "${duplicate}" — each step needs a unique key.`,
    };
  }
  const known = new Set(keys);
  for (const step of typed) {
    const dependsOn = Array.isArray(step.dependsOn) ? (step.dependsOn as string[]) : [];
    if (dependsOn.includes(step.key as string)) {
      return { ok: false, error: `Step "${step.key as string}" cannot depend on itself.` };
    }
    const missing = dependsOn.find((dep) => !known.has(dep));
    if (missing) {
      return {
        ok: false,
        error: `Step "${step.key as string}" depends on unknown step "${missing}".`,
      };
    }
  }
  return { ok: true, definition: obj, steps: typed as unknown as DefinitionStep[] };
}

/** Routes `/workflows/new` (create) and `/workflows/:id/edit` (edit) to one editor. */
export function WorkflowEditorPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  return workflowId ? (
    <EditWorkflow workflowId={workflowId} />
  ) : (
    <EditorForm
      title="New workflow"
      breadcrumbLabel="New workflow"
      submitLabel="Create workflow"
      initial={{ name: '', description: '', cron: '', raw: TEMPLATE }}
      onSubmit={(payload) => createWorkflow(payload)}
    />
  );
}

/** Loads an existing workflow + its current definition, then renders the editor. */
function EditWorkflow({ workflowId }: { workflowId: string }) {
  const queryClient = useQueryClient();
  const workflowQuery = useQuery({
    queryKey: ['workflow', workflowId],
    queryFn: () => getWorkflow(workflowId),
  });
  const version = workflowQuery.data?.versions[0]?.version;
  const definitionQuery = useQuery({
    queryKey: ['workflow-version', workflowId, version],
    queryFn: () => getWorkflowVersion(workflowId, version as number),
    enabled: version !== undefined,
  });
  const versionsQuery = useQuery({
    queryKey: ['workflow-versions', workflowId],
    queryFn: () => listWorkflowVersions(workflowId),
  });

  const crumbs = [{ label: 'Dashboard', to: '/' }, { label: 'Edit' }];

  if (workflowQuery.isError || definitionQuery.isError || versionsQuery.isError) {
    return (
      <AppLayout title="Edit workflow" breadcrumbs={crumbs}>
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          Failed to load workflow.
        </p>
      </AppLayout>
    );
  }
  if (!workflowQuery.data || !definitionQuery.data) {
    return (
      <AppLayout title="Edit workflow" breadcrumbs={crumbs}>
        <p className="text-sm text-slate-500">Loading workflow…</p>
      </AppLayout>
    );
  }

  const workflow = workflowQuery.data;
  return (
    <EditorForm
      title="Edit workflow"
      subtitle={workflow.name}
      breadcrumbLabel="Edit"
      submitLabel="Save changes"
      initial={{
        name: workflow.name,
        description: workflow.description ?? '',
        cron: workflow.cronExpression ?? '',
        raw: JSON.stringify(definitionQuery.data.definition, null, 2),
      }}
      onSubmit={async (payload) => {
        await updateWorkflow(workflowId, {
          name: payload.name,
          description: payload.description ?? null,
          cronExpression: payload.cronExpression ?? null,
        });
        await createWorkflowVersion(workflowId, payload.definition);
      }}
      versions={versionsQuery.data}
      onRollback={async (versionToRollback) => {
        if (
          confirm(
            `Are you sure you want to rollback to version ${versionToRollback}? This will create a new version with the old definition.`,
          )
        ) {
          await rollbackWorkflowVersion(workflowId, versionToRollback);
          await queryClient.invalidateQueries({ queryKey: ['workflow', workflowId] });
          await queryClient.invalidateQueries({ queryKey: ['workflow-versions', workflowId] });
        }
      }}
    />
  );
}

interface EditorInitial {
  name: string;
  description: string;
  cron: string;
  raw: string;
}

interface SubmitPayload {
  name: string;
  description?: string;
  cronExpression?: string;
  definition: unknown;
}

function EditorForm({
  title,
  subtitle,
  breadcrumbLabel,
  submitLabel,
  initial,
  onSubmit,
  versions,
  onRollback,
}: {
  title: string;
  subtitle?: string;
  breadcrumbLabel: string;
  submitLabel: string;
  initial: EditorInitial;
  onSubmit: (payload: SubmitPayload) => Promise<unknown>;
  versions?: WorkflowVersionSummary[];
  onRollback?: (version: number) => Promise<unknown>;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [cron, setCron] = useState(initial.cron);
  const [raw, setRaw] = useState(initial.raw);
  const [aiPrompt, setAiPrompt] = useState('');

  const parsed = useMemo(() => parseDefinition(raw), [raw]);

  const generateMutation = useMutation({
    mutationFn: () => generateWorkflow(aiPrompt.trim()),
    onSuccess: (result) => setRaw(JSON.stringify(result.definition, null, 2)),
  });
  const aiError =
    generateMutation.error instanceof ApiError
      ? generateMutation.error.message
      : generateMutation.isError
        ? 'Generation failed, try again'
        : null;

  const mutation = useMutation({
    mutationFn: () =>
      onSubmit({
        name: name.trim(),
        description: description.trim() || undefined,
        cronExpression: cron.trim() || undefined,
        definition: parsed.definition,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflows'] });
      navigate('/');
    },
  });

  const serverError =
    mutation.error instanceof ApiError
      ? mutation.error.message
      : mutation.isError
        ? 'Failed to save workflow'
        : null;

  const canSave = name.trim().length > 0 && parsed.ok && !mutation.isPending;

  const inputClass =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 ' +
    'placeholder-slate-400 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';

  return (
    <AppLayout
      title={title}
      subtitle={subtitle}
      breadcrumbs={[{ label: 'Dashboard', to: '/' }, { label: breadcrumbLabel }]}
      actions={
        <>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => mutation.mutate()}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {mutation.isPending ? 'Saving…' : submitLabel}
          </button>
        </>
      }
    >
      <div className="space-y-6">
        <section className="rounded-xl border border-violet-200 bg-violet-50/60 p-5">
          <h2 className="font-semibold text-violet-900">✨ Generate with AI</h2>
          <p className="text-xs text-slate-500">
            Describe the workflow in plain English and let AI draft the definition.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              value={aiPrompt}
              onChange={(event) => setAiPrompt(event.target.value)}
              placeholder="e.g. Fetch an order from an API, then notify Slack if the total is over 100"
              className="flex-1 rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
            />
            <button
              type="button"
              disabled={aiPrompt.trim().length === 0 || generateMutation.isPending}
              onClick={() => generateMutation.mutate()}
              className="shrink-0 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generateMutation.isPending ? 'Generating…' : 'Generate'}
            </button>
          </div>
          {aiError && (
            <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
              {aiError}
            </p>
          )}
          {generateMutation.isSuccess && (
            <p className="mt-2 text-xs text-violet-700">
              Draft generated below — review, tweak, and save.
            </p>
          )}
        </section>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="wf-name" className="mb-1 block text-sm font-medium text-slate-700">
              Name
            </label>
            <input
              id="wf-name"
              className={inputClass}
              placeholder="My workflow"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="wf-cron" className="mb-1 block text-sm font-medium text-slate-700">
              Cron expression <span className="text-slate-400">(optional)</span>
            </label>
            <input
              id="wf-cron"
              className={inputClass}
              placeholder="0 2 * * *"
              value={cron}
              onChange={(event) => setCron(event.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="wf-desc" className="mb-1 block text-sm font-medium text-slate-700">
              Description <span className="text-slate-400">(optional)</span>
            </label>
            <input
              id="wf-desc"
              className={inputClass}
              placeholder="What this workflow does"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label htmlFor="wf-def" className="text-sm font-medium text-slate-700">
                Definition (JSON)
              </label>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                  parsed.ok
                    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                    : 'bg-red-50 text-red-700 ring-red-200'
                }`}
              >
                {parsed.ok ? 'Valid' : 'Invalid'}
              </span>
            </div>
            <textarea
              id="wf-def"
              spellCheck={false}
              value={raw}
              onChange={(event) => setRaw(event.target.value)}
              className="h-96 w-full rounded-xl border border-slate-300 bg-white p-3 font-mono text-xs text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
            {!parsed.ok && <p className="mt-2 text-xs text-red-600">{parsed.error}</p>}
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">Preview</p>
            {parsed.ok && parsed.steps ? (
              <DagView steps={parsed.steps} statusByKey={{}} />
            ) : (
              <div className="flex h-96 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white text-sm text-slate-400">
                Fix the definition to preview the DAG
              </div>
            )}
          </div>
        </div>

        {serverError && (
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
            {serverError}
          </p>
        )}

        {versions && versions.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="mb-4 text-sm font-semibold text-slate-900">Version History</h3>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold text-slate-900">Version</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-slate-900">
                      Created At
                    </th>
                    <th className="px-4 py-2.5 text-right font-semibold text-slate-900">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {versions.map((ver, idx) => (
                    <tr key={ver.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-900">
                        v{ver.version}{' '}
                        {idx === 0 && (
                          <span className="ml-2 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 ring-1 ring-inset ring-indigo-200">
                            Current
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                        {new Date(ver.createdAt).toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {idx !== 0 && onRollback && (
                          <button
                            type="button"
                            onClick={() => onRollback(ver.version)}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                          >
                            Rollback
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
