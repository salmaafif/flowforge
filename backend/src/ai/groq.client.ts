import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Raised when the Groq API returns a non-2xx response or unusable content. */
export class GroqApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GroqApiError';
  }
}

export interface GenerateJsonParams {
  systemInstruction: string;
  prompt: string;
}

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1';

/**
 * Thin wrapper over Groq's OpenAI-compatible chat completions endpoint. Isolated
 * behind a class so the analysis service depends on a small interface (and tests
 * can mock it) rather than on fetch/HTTP details.
 *
 * Groq's JSON mode (`response_format: { type: "json_object" }`) guarantees
 * syntactically valid JSON but — unlike Gemini's `responseSchema` — does not
 * enforce a specific shape, so the exact field list is spelled out in the system
 * instruction and re-validated against Zod by the caller (layer 2 of the
 * malformed-output guard).
 */
@Injectable()
export class GroqClient {
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('GROQ_API_KEY') || undefined;
    this.model = config.get<string>('GROQ_MODEL') ?? DEFAULT_MODEL;
    this.baseUrl = config.get<string>('GROQ_BASE_URL') ?? DEFAULT_BASE_URL;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * @throws GroqApiError on transport failure, a non-2xx response, or output
   *   that isn't parseable JSON.
   */
  async generateJson(params: GenerateJsonParams): Promise<unknown> {
    if (!this.apiKey) {
      throw new GroqApiError(503, 'Groq API key is not configured');
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: params.systemInstruction },
          { role: 'user', content: params.prompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new GroqApiError(response.status, await response.text());
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string') {
      throw new GroqApiError(502, 'Groq returned no content');
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new GroqApiError(502, 'Groq returned non-JSON content');
    }
  }
}
