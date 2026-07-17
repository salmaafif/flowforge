import {
  BadGatewayException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Role, RunStatus, StepStatus } from '@prisma/client';

import { AuthenticatedUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { FailureAnalysisService } from './failure-analysis.service';
import { GeminiApiError, GeminiClient } from './gemini.client';

const user: AuthenticatedUser = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  email: 'viewer@acme.test',
  role: Role.VIEWER,
};

const failedRun = {
  id: 'run-1',
  status: RunStatus.FAILED,
  trigger: 'MANUAL',
  workflow: { name: 'Sample ETL' },
  workflowVersion: { version: 1, definition: { steps: [] } },
  steps: [
    {
      stepKey: 'fetch',
      type: 'HTTP',
      status: StepStatus.FAILED,
      attempts: 4,
      durationMs: 4276,
      error: 'HTTP request failed with status 404',
      output: null,
    },
    {
      stepKey: 'process',
      type: 'SCRIPT',
      status: StepStatus.SKIPPED,
      attempts: 0,
      durationMs: null,
      error: null,
      output: null,
    },
  ],
};

const analysis = {
  summary: 'The HTTP step got a 404.',
  rootCause: 'The URL points to a non-existent endpoint.',
  suggestedFix: 'Fix the URL in step "fetch".',
  confidence: 'high',
};

describe('FailureAnalysisService', () => {
  const prismaMock = { run: { findFirst: jest.fn() } };
  const geminiMock = {
    isConfigured: jest.fn().mockReturnValue(true),
    generateJson: jest.fn(),
  };

  const service = new FailureAnalysisService(
    prismaMock as unknown as PrismaService,
    geminiMock as unknown as GeminiClient,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    geminiMock.isConfigured.mockReturnValue(true);
    prismaMock.run.findFirst.mockResolvedValue(failedRun);
    geminiMock.generateJson.mockResolvedValue(analysis);
  });

  it('answers 503 when no API key is configured', async () => {
    geminiMock.isConfigured.mockReturnValue(false);
    await expect(service.analyzeRun(user, 'run-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(geminiMock.generateJson).not.toHaveBeenCalled();
  });

  it("answers 404 for another tenant's run", async () => {
    prismaMock.run.findFirst.mockResolvedValue(null);
    await expect(service.analyzeRun(user, 'run-x')).rejects.toBeInstanceOf(NotFoundException);
    expect(prismaMock.run.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'run-x', tenantId: 'tenant-1' } }),
    );
  });

  it('answers 409 when the run did not fail', async () => {
    prismaMock.run.findFirst.mockResolvedValue({ ...failedRun, status: RunStatus.SUCCEEDED });
    await expect(service.analyzeRun(user, 'run-1')).rejects.toBeInstanceOf(ConflictException);
    expect(geminiMock.generateJson).not.toHaveBeenCalled();
  });

  it('returns the structured analysis on success', async () => {
    await expect(service.analyzeRun(user, 'run-1')).resolves.toEqual(analysis);
  });

  it('sends the failed step error inside the prompt context', async () => {
    await service.analyzeRun(user, 'run-1');

    const request = geminiMock.generateJson.mock.calls[0][0] as {
      prompt: string;
      systemInstruction: string;
      responseSchema: unknown;
    };
    expect(request.prompt).toContain('HTTP request failed with status 404');
    expect(request.prompt).toContain('step "fetch"');
    expect(request.prompt).toContain('SKIPPED');
    expect(request.systemInstruction).toContain('FlowForge');
    expect(request.responseSchema).toBeDefined();
  });

  it('truncates oversized error messages (token-limit guard)', async () => {
    prismaMock.run.findFirst.mockResolvedValue({
      ...failedRun,
      steps: [{ ...failedRun.steps[0], error: 'x'.repeat(5000) }],
    });

    await service.analyzeRun(user, 'run-1');

    const prompt = (geminiMock.generateJson.mock.calls[0][0] as { prompt: string }).prompt;
    expect(prompt).toContain('…[truncated]');
    expect(prompt.length).toBeLessThan(5000);
  });

  it('answers 502 when the model output fails schema validation', async () => {
    geminiMock.generateJson.mockResolvedValue({ summary: 'missing other fields' });
    await expect(service.analyzeRun(user, 'run-1')).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('maps Gemini API errors to 502', async () => {
    geminiMock.generateJson.mockRejectedValue(new GeminiApiError(429, 'rate limited'));
    await expect(service.analyzeRun(user, 'run-1')).rejects.toBeInstanceOf(BadGatewayException);
  });
});
