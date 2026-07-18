import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { CyclicWorkflowError, InvalidWorkflowDefinitionError } from '../engine/dag/errors';
import { WorkflowDag } from '../engine/dag/workflow-dag';
import { WorkflowDefinition } from '../engine/dag/workflow-definition.schema';
import { WorkflowDefinitionValidator } from '../engine/dag/workflow-definition.validator';
import { GroqApiError, GroqClient } from './groq.client';

/**
 * Natural-language workflow builder (requirement G, second AI feature): turns a
 * plain-English description into a valid DAG definition via Groq.
 *
 * Guards against malformed LLM output are layered, mirroring the failure-analysis
 * feature: (1) Groq JSON mode → syntactically valid JSON; (2) the exact schema is
 * re-validated with the same Zod validator the create endpoint uses; (3) the DAG is
 * checked for cycles. Any failure maps to 502 — the model never produces a workflow
 * the engine couldn't run.
 */
@Injectable()
export class WorkflowGeneratorService {
  private readonly logger = new Logger(WorkflowGeneratorService.name);

  constructor(
    private readonly groq: GroqClient,
    private readonly validator: WorkflowDefinitionValidator,
  ) {}

  async generate(prompt: string): Promise<{ definition: WorkflowDefinition }> {
    if (!this.groq.isConfigured()) {
      throw new ServiceUnavailableException('AI generation is not configured (set GROQ_API_KEY)');
    }

    let raw: unknown;
    try {
      raw = await this.groq.generateJson({
        systemInstruction: this.systemPrompt(),
        // The description is already capped by the DTO (max 2000 chars).
        prompt: `Generate a workflow for this description:\n${prompt}`,
      });
    } catch (error) {
      if (error instanceof GroqApiError) {
        this.logger.error(`Groq error generating workflow: ${error.status} ${error.message}`);
        throw new BadGatewayException('AI generation failed, please try again');
      }
      throw error;
    }

    // Layer 2: re-validate the shape with the same validator the create path uses.
    let definition: WorkflowDefinition;
    try {
      definition = this.validator.validate(this.unwrap(raw));
    } catch (error) {
      if (error instanceof InvalidWorkflowDefinitionError) {
        this.logger.warn('AI produced an invalid workflow definition');
        throw new BadGatewayException(
          'AI produced an invalid workflow — try rephrasing your description',
        );
      }
      throw error;
    }

    // Layer 3: reject a definition whose dependency graph has a cycle.
    try {
      new WorkflowDag(definition).executionLevels();
    } catch (error) {
      if (error instanceof CyclicWorkflowError) {
        throw new BadGatewayException(
          'AI produced a workflow with a dependency cycle — try rephrasing',
        );
      }
      throw error;
    }

    return { definition };
  }

  /** Accept either the definition directly or a common wrapper key. */
  private unwrap(raw: unknown): unknown {
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      if (Array.isArray(obj.steps)) {
        return obj;
      }
      if (obj.definition && typeof obj.definition === 'object') {
        return obj.definition;
      }
      if (obj.workflow && typeof obj.workflow === 'object') {
        return obj.workflow;
      }
    }
    return raw;
  }

  /**
   * Prompt engineering: the system prompt fully specifies FlowForge's DAG schema —
   * step types, per-type config, dependency rules — so the model emits definitions
   * that pass validation on the first try. The output contract ("JSON only") keeps
   * the response directly consumable.
   */
  private systemPrompt(): string {
    return [
      'You are the workflow builder for FlowForge, a DAG-based workflow engine.',
      'Convert the user description into ONE JSON object that is a valid workflow',
      'definition. Respond with ONLY that JSON object — no markdown, no prose.',
      '',
      'Shape:',
      '{ "timeoutMs"?: number (positive, whole-workflow timeout),',
      '  "steps": [ ...at least one step... ] }',
      '',
      'Every step has:',
      '- "key": unique id, letters/numbers/_/- only',
      '- "name": short human label',
      '- "type": one of "HTTP", "SCRIPT", "DELAY", "CONDITION"',
      '- "dependsOn": array of other step keys that must finish first (use [] for none)',
      '- optional "retry": { "maxRetries": 0-20, "backoff": { "strategy": "fixed"|"exponential", "initialDelayMs": number, "factor"?: number>=1, "maxDelayMs"?: number } }',
      '',
      'Per-type "config":',
      '- HTTP: { "method": "GET"|"POST"|"PUT"|"PATCH"|"DELETE", "url": string, "headers"?: object, "body"?: any, "timeoutMs"?: number }',
      '- SCRIPT: { "code": string } — an async JS function body; upstream step outputs are available as `input.<stepKey>`; use `return` to output a value',
      '- DELAY: { "delayMs": number }',
      '- CONDITION: { "expression": string } — a JS boolean expression over `outputs.<stepKey>`; when it is false, dependent steps are skipped',
      '',
      'Rules: keys are unique; every dependsOn entry references an existing key; no',
      'cycles; a step never depends on itself. Prefer realistic URLs and concise',
      'script code. Keep it minimal but faithful to the description.',
    ].join('\n');
  }
}
