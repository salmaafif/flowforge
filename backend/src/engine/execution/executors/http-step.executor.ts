import { WorkflowStep } from '../../dag/workflow-definition.schema';
import {
  StepExecutionContext,
  StepExecutionError,
  StepExecutor,
  StepResult,
} from '../step-executor';

interface HttpStepOutput {
  status: number;
  ok: boolean;
  body: unknown;
}

/**
 * Executes an HTTP step using the global fetch API. Supports a per-step timeout
 * (combined with the context's abort signal) and parses the response body as JSON
 * when the server says so, otherwise as text.
 */
export class HttpStepExecutor implements StepExecutor {
  readonly type = 'HTTP' as const;

  async execute(step: WorkflowStep, context: StepExecutionContext): Promise<StepResult> {
    if (step.type !== 'HTTP') {
      throw new StepExecutionError(`HttpStepExecutor received a ${step.type} step`);
    }

    const { method, url, headers, body, timeoutMs } = step.config;
    const controller = new AbortController();
    const abortFromContext = (): void => controller.abort();
    context.signal?.addEventListener('abort', abortFromContext, { once: true });
    const timer =
      timeoutMs !== undefined ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

    try {
      const response = await fetch(url, {
        method,
        headers: this.buildHeaders(headers, body),
        body: this.serializeBody(method, body),
        signal: controller.signal,
      });

      const output: HttpStepOutput = {
        status: response.status,
        ok: response.ok,
        body: await this.parseBody(response),
      };

      if (!response.ok) {
        throw new StepExecutionError(`HTTP request failed with status ${response.status}`, {
          cause: output,
        });
      }

      return { output };
    } catch (error) {
      if (error instanceof StepExecutionError) {
        throw error;
      }
      throw new StepExecutionError(`HTTP request to ${url} failed`, { cause: error });
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      context.signal?.removeEventListener('abort', abortFromContext);
    }
  }

  private buildHeaders(
    headers: Record<string, string> | undefined,
    body: unknown,
  ): Record<string, string> {
    const resolved: Record<string, string> = { ...headers };
    const hasContentType = Object.keys(resolved).some(
      (key) => key.toLowerCase() === 'content-type',
    );
    if (body !== undefined && !hasContentType) {
      resolved['content-type'] = 'application/json';
    }
    return resolved;
  }

  private serializeBody(method: string, body: unknown): string | undefined {
    if (body === undefined || method === 'GET' || method === 'DELETE') {
      return undefined;
    }
    return typeof body === 'string' ? body : JSON.stringify(body);
  }

  private async parseBody(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return response.json();
    }
    return response.text();
  }
}
