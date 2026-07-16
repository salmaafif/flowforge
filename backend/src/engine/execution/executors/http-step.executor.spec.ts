import { WorkflowStep } from '../../dag/workflow-definition.schema';
import { StepExecutionError } from '../step-executor';
import { HttpStepExecutor } from './http-step.executor';

type HttpConfig = Extract<WorkflowStep, { type: 'HTTP' }>['config'];

const httpStep = (config: HttpConfig): WorkflowStep => ({
  key: 'call',
  name: 'Call API',
  type: 'HTTP',
  dependsOn: [],
  config,
});

describe('HttpStepExecutor', () => {
  const executor = new HttpStepExecutor();
  let fetchMock: jest.SpyInstance;

  afterEach(() => {
    fetchMock?.mockRestore();
  });

  it('returns status and parsed JSON body on success', async () => {
    fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ hello: 'world' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await executor.execute(
      httpStep({ method: 'GET', url: 'https://example.com/api' }),
      { outputs: {} },
    );

    expect(result.output).toEqual({ status: 200, ok: true, body: { hello: 'world' } });
  });

  it('sends a JSON body and content-type for POST requests', async () => {
    fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 201 }));

    await executor.execute(
      httpStep({ method: 'POST', url: 'https://example.com/api', body: { name: 'wf' } }),
      { outputs: {} },
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(JSON.stringify({ name: 'wf' }));
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('throws a StepExecutionError on a non-2xx response', async () => {
    fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('nope', { status: 500 }));

    await expect(
      executor.execute(httpStep({ method: 'GET', url: 'https://example.com/api' }), {
        outputs: {},
      }),
    ).rejects.toBeInstanceOf(StepExecutionError);
  });

  it('wraps network errors in a StepExecutionError', async () => {
    fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      executor.execute(httpStep({ method: 'GET', url: 'https://example.com/api' }), {
        outputs: {},
      }),
    ).rejects.toBeInstanceOf(StepExecutionError);
  });
});
