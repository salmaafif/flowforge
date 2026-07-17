import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RunStatus, StepStatus } from '@prisma/client';
import { z } from 'zod';

import { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { GeminiApiError, GeminiClient, GeminiResponseSchema } from './gemini.client';

/**
 * Contract for the analysis. Guarding against malformed LLM output is layered
 * (requirement G):
 *   1. Structured output — Gemini is constrained to `RESPONSE_SCHEMA` server-side
 *      (`responseMimeType: application/json` + `responseSchema`), so free-text
 *      answers cannot occur.
 *   2. The parsed JSON is re-validated against the Zod schema below; a blocked or
 *      malformed candidate fails here.
 *   3. Any validation/API failure maps to 502 instead of leaking raw text.
 */
export const failureAnalysisSchema = z.object({
  summary: z.string(),
  rootCause: z.string(),
  suggestedFix: z.string(),
  confidence: z.enum(['low', 'medium', 'high']),
});

export type FailureAnalysis = z.infer<typeof failureAnalysisSchema>;

/** Gemini structured-output schema mirroring failureAnalysisSchema. */
const RESPONSE_SCHEMA: GeminiResponseSchema = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'One or two sentences: what went wrong, in plain language',
    },
    rootCause: {
      type: 'string',
      description: 'The most likely root cause, referencing step keys and error details',
    },
    suggestedFix: {
      type: 'string',
      description: 'Concrete, actionable steps the user should take to fix or mitigate',
    },
    confidence: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
      description: 'How confident the diagnosis is given the available context',
    },
  },
  required: ['summary', 'rootCause', 'suggestedFix', 'confidence'],
  propertyOrdering: ['summary', 'rootCause', 'suggestedFix', 'confidence'],
};

/**
 * Token-limit handling (requirement G): the run context is trimmed at the field
 * level before prompting — long error strings, step outputs, and the stored DAG
 * definition are clipped, and only failed steps carry full detail (other steps are
 * summarised to one line each). This bounds the prompt regardless of workflow size.
 */
const LIMITS = {
  error: 600,
  output: 300,
  definition: 3_000,
};

const ANALYZABLE_STATUSES: RunStatus[] = [RunStatus.FAILED, RunStatus.TIMED_OUT];

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…[truncated]`;
}

/**
 * Requirement G: intelligent failure analysis. Collects the failed run's context,
 * sends it to Gemini, and returns a structured diagnosis for the dashboard.
 */
@Injectable()
export class FailureAnalysisService {
  private readonly logger = new Logger(FailureAnalysisService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiClient,
  ) {}

  async analyzeRun(user: AuthenticatedUser, runId: string): Promise<FailureAnalysis> {
    if (!this.gemini.isConfigured()) {
      throw new ServiceUnavailableException('AI analysis is not configured (set GEMINI_API_KEY)');
    }

    const run = await this.prisma.run.findFirst({
      where: { id: runId, tenantId: user.tenantId },
      include: {
        steps: true,
        workflow: { select: { name: true } },
        workflowVersion: { select: { version: true, definition: true } },
      },
    });
    if (!run) {
      throw new NotFoundException('Run not found');
    }
    if (!ANALYZABLE_STATUSES.includes(run.status)) {
      throw new ConflictException('Only failed or timed-out runs can be analyzed');
    }

    let raw: unknown;
    try {
      raw = await this.gemini.generateJson({
        systemInstruction: this.systemPrompt(),
        prompt: this.buildRunContext(run),
        responseSchema: RESPONSE_SCHEMA,
      });
    } catch (error) {
      if (error instanceof GeminiApiError) {
        this.logger.error(`Gemini error for run ${runId}: ${error.status} ${error.message}`);
        throw new BadGatewayException('AI analysis failed, please try again');
      }
      throw error;
    }

    const validated = failureAnalysisSchema.safeParse(raw);
    if (!validated.success) {
      this.logger.warn(`Gemini output failed schema validation for run ${runId}`);
      throw new BadGatewayException('AI returned an unusable analysis, try again');
    }
    return validated.data;
  }

  /**
   * Prompt-engineering approach (requirement G): a fixed system instruction pins
   * the role and expectations; the volatile run context travels in the user turn
   * as labelled sections, so the model attributes each fact (definition vs. runtime
   * error) instead of guessing from an unstructured blob.
   */
  private systemPrompt(): string {
    return [
      'You are the failure-analysis assistant of FlowForge, a workflow orchestration',
      'platform where DAGs of steps (HTTP calls, sandboxed Node.js scripts, delays,',
      'conditional branches) run with per-step retries and a global timeout.',
      'Diagnose why the given run failed. Be specific: name the step keys involved,',
      'distinguish transient causes (network, rate limits) from permanent ones',
      '(wrong URL, bad expression, bug in script code), and suggest the smallest',
      'concrete fix. If retries were exhausted on a transient-looking error, say so.',
    ].join(' ');
  }

  private buildRunContext(run: {
    id: string;
    status: RunStatus;
    trigger: string;
    workflow: { name: string };
    workflowVersion: { version: number; definition: unknown };
    steps: Array<{
      stepKey: string;
      type: string;
      status: StepStatus;
      attempts: number;
      durationMs: number | null;
      error: string | null;
      output: unknown;
    }>;
  }): string {
    const failed = run.steps.filter((step) => step.status === StepStatus.FAILED);
    const others = run.steps.filter((step) => step.status !== StepStatus.FAILED);

    const failedSection = failed
      .map((step) =>
        [
          `- step "${step.stepKey}" (${step.type}) after ${step.attempts} attempt(s),`,
          `${step.durationMs ?? '?'}ms:`,
          `error: ${clip(step.error ?? 'unknown', LIMITS.error)}`,
        ].join(' '),
      )
      .join('\n');

    const othersSection = others
      .map((step) => {
        const output =
          step.output === null || step.output === undefined
            ? ''
            : ` output: ${clip(JSON.stringify(step.output), LIMITS.output)}`;
        return `- step "${step.stepKey}" (${step.type}): ${step.status}${output}`;
      })
      .join('\n');

    return [
      `<workflow name="${run.workflow.name}" version="${run.workflowVersion.version}">`,
      clip(JSON.stringify(run.workflowVersion.definition), LIMITS.definition),
      '</workflow>',
      `<run id="${run.id}" status="${run.status}" trigger="${run.trigger}">`,
      '<failed_steps>',
      failedSection || '(none recorded — the run may have timed out before any step failed)',
      '</failed_steps>',
      '<other_steps>',
      othersSection || '(none)',
      '</other_steps>',
      '</run>',
    ].join('\n');
  }
}
