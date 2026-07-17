import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Raised when the Gemini API returns a non-2xx response or unusable content. */
export class GeminiApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GeminiApiError';
  }
}

/** Subset of the OpenAPI schema Gemini accepts for structured output. */
export interface GeminiResponseSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
  propertyOrdering?: string[];
}

export interface GenerateJsonParams {
  systemInstruction: string;
  prompt: string;
  responseSchema: GeminiResponseSchema;
}

const DEFAULT_MODEL = 'gemini-flash-latest';
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Thin wrapper over the Gemini generateContent REST endpoint. Isolated behind a
 * class so the analysis service depends on a small interface (and tests can mock
 * it) rather than on fetch/HTTP details. Uses structured output
 * (`responseMimeType: application/json` + `responseSchema`) so the model is
 * constrained server-side to the requested JSON shape.
 */
@Injectable()
export class GeminiClient {
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('GEMINI_API_KEY') || undefined;
    this.model = config.get<string>('GEMINI_MODEL') ?? DEFAULT_MODEL;
    this.baseUrl = config.get<string>('GEMINI_BASE_URL') ?? DEFAULT_BASE_URL;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * @throws GeminiApiError on transport failure, a non-2xx response, a blocked
   *   candidate, or output that isn't parseable JSON.
   */
  async generateJson(params: GenerateJsonParams): Promise<unknown> {
    if (!this.apiKey) {
      throw new GeminiApiError(503, 'Gemini API key is not configured');
    }

    const response = await fetch(`${this.baseUrl}/models/${this.model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: params.systemInstruction }] },
        contents: [{ parts: [{ text: params.prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: params.responseSchema,
        },
      }),
    });

    if (!response.ok) {
      throw new GeminiApiError(response.status, await response.text());
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') {
      throw new GeminiApiError(502, 'Gemini returned no content (possibly blocked)');
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new GeminiApiError(502, 'Gemini returned non-JSON content');
    }
  }
}
