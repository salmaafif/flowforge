import { ConditionStepExecutor } from './executors/condition-step.executor';
import { DelayStepExecutor } from './executors/delay-step.executor';
import { HttpStepExecutor } from './executors/http-step.executor';
import { ScriptStepExecutor } from './executors/script-step.executor';
import { StepExecutorRegistry } from './step-executor.registry';

export interface DefaultRegistryOptions {
  /** Wall-clock timeout for the SCRIPT sandbox child process. */
  scriptSandboxTimeoutMs?: number;
}

/**
 * Assembles a registry wired with an executor for every built-in step type. This is
 * the composition root for the execution layer; the engine depends on the registry
 * abstraction, not on this factory.
 */
export function createDefaultStepExecutorRegistry(
  options: DefaultRegistryOptions = {},
): StepExecutorRegistry {
  return new StepExecutorRegistry()
    .register(new HttpStepExecutor())
    .register(new ScriptStepExecutor(options.scriptSandboxTimeoutMs))
    .register(new DelayStepExecutor())
    .register(new ConditionStepExecutor());
}
