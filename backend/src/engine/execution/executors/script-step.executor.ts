import { spawn } from 'node:child_process';

import { WorkflowStep } from '../../dag/workflow-definition.schema';
import {
  StepAbortedError,
  StepExecutionContext,
  StepExecutionError,
  StepExecutor,
  StepResult,
} from '../step-executor';

/**
 * Fixed bootstrap run inside the child process. It is a constant string — user code
 * is never interpolated into it; instead it arrives as data over stdin — so there is
 * no way to break out of the runner itself. The user's `code` is treated as an async
 * function body that receives `input` (the upstream step outputs) and may `return`.
 */
const SANDBOX_RUNNER = `
let raw = '';
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', async () => {
  try {
    const { code, input } = JSON.parse(raw);
    const runner = new Function('input', '"use strict"; return (async () => {' + code + '\\n})();');
    const output = await runner(input);
    process.stdout.write(JSON.stringify({ ok: true, output: output === undefined ? null : output }));
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    process.stdout.write(JSON.stringify({ ok: false, error: message }));
  }
});
`;

/** Env vars the child needs to start on Windows/POSIX, without leaking app secrets. */
const SANDBOX_ENV_ALLOWLIST = ['SystemRoot', 'windir', 'TEMP', 'TMP', 'PATH', 'PATHEXT'];

interface SandboxResult {
  ok: boolean;
  output?: unknown;
  error?: string;
}

/**
 * Executes a SCRIPT step by running the user code in an isolated Node child process.
 *
 * Isolation properties: a separate process (cannot touch the API's memory), a hard
 * wall-clock timeout enforced with SIGKILL, a capped heap, and a scrubbed environment.
 * The code is still tenant-authored and trusted within the tenant (same model as
 * GitHub Actions); stronger sandboxing (dropped syscalls / a locked-down container)
 * is noted as a future hardening in the README trade-offs.
 */
export class ScriptStepExecutor implements StepExecutor {
  readonly type = 'SCRIPT' as const;

  constructor(private readonly sandboxTimeoutMs = 10_000) {}

  async execute(step: WorkflowStep, context: StepExecutionContext): Promise<StepResult> {
    if (step.type !== 'SCRIPT') {
      throw new StepExecutionError(`ScriptStepExecutor received a ${step.type} step`);
    }

    const raw = await this.runInSandbox(step.config.code, context.outputs, context.signal);
    const result = this.parseResult(raw);
    if (!result.ok) {
      throw new StepExecutionError(`Script step failed: ${result.error ?? 'unknown error'}`);
    }
    return { output: result.output ?? null };
  }

  private runInSandbox(code: string, input: unknown, signal?: AbortSignal): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new StepAbortedError());
        return;
      }

      const child = spawn(process.execPath, ['--max-old-space-size=128', '-e', SANDBOX_RUNNER], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: this.buildSandboxEnv(),
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const cleanup = (): void => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      const settle = (action: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        action();
      };

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        settle(() =>
          reject(
            new StepExecutionError(`Script exceeded ${this.sandboxTimeoutMs}ms sandbox timeout`),
          ),
        );
      }, this.sandboxTimeoutMs);

      const onAbort = (): void => {
        child.kill('SIGKILL');
        settle(() => reject(new StepAbortedError()));
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        settle(() =>
          reject(new StepExecutionError('Failed to start sandbox process', { cause: error })),
        );
      });
      child.on('close', (exitCode) => {
        settle(() => {
          if (stdout.length > 0) {
            resolve(stdout);
          } else {
            reject(
              new StepExecutionError(`Sandbox exited with code ${exitCode}: ${stderr.trim()}`),
            );
          }
        });
      });

      try {
        child.stdin.write(JSON.stringify({ code, input }));
        child.stdin.end();
      } catch (error) {
        settle(() =>
          reject(new StepExecutionError('Failed to send code to sandbox', { cause: error })),
        );
      }
    });
  }

  private buildSandboxEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const key of SANDBOX_ENV_ALLOWLIST) {
      const value = process.env[key];
      if (value !== undefined) {
        env[key] = value;
      }
    }
    return env;
  }

  private parseResult(raw: string): SandboxResult {
    try {
      return JSON.parse(raw) as SandboxResult;
    } catch {
      throw new StepExecutionError(`Sandbox returned invalid output: ${raw}`);
    }
  }
}
