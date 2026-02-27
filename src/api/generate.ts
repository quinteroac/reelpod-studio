export const GENERATE_ENDPOINT_PATH = '/api/generate';

export const MIN_TEMPO = 60;
export const MAX_TEMPO = 120;
const MAX_PATTERN_LENGTH = 500;

type JsonRecord = Record<string, unknown>;

export interface GenerateRequestBody {
  mood: string;
  tempo: number;
  style: string;
}

interface OpenAiMessage {
  role: 'system' | 'user';
  content: string;
}

interface OpenAiRequestBody {
  model: string;
  messages: OpenAiMessage[];
  temperature: number;
}

interface OpenAiSuccessResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export interface GenerateHandlerDependencies {
  fetchFn?: typeof fetch;
  getOpenAiApiKey?: () => string | undefined;
  openAiUrl?: string;
  model?: string;
}

const defaultGetOpenAiApiKey = (): string | undefined => {
  const maybeProcess = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return maybeProcess.process?.env?.OPENAI_API_KEY;
};

const buildPrompt = (input: GenerateRequestBody): OpenAiMessage[] => {
  return [
    {
      role: 'system',
      content:
        'You are a Strudel pattern generator. Return only a valid Strudel pattern string. No markdown. No explanation.'
    },
    {
      role: 'user',
      content: `Generate one lo-fi Strudel pattern using mood "${input.mood}", style "${input.style}", and tempo ${input.tempo}. Return only the pattern.`
    }
  ];
};

const jsonResponse = (status: number, payload: JsonRecord): Response => {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8'
    }
  });
};

const isObject = (value: unknown): value is JsonRecord => {
  return typeof value === 'object' && value !== null;
};

const parseAndValidatePayload = (value: unknown): GenerateRequestBody | null => {
  if (!isObject(value)) {
    return null;
  }

  const { mood, tempo, style } = value;

  if (typeof mood !== 'string' || mood.trim().length === 0) {
    return null;
  }

  if (typeof style !== 'string' || style.trim().length === 0) {
    return null;
  }

  if (typeof tempo !== 'number' || Number.isNaN(tempo)) {
    return null;
  }

  if (tempo < MIN_TEMPO || tempo > MAX_TEMPO) {
    return null;
  }

  return {
    mood: mood.trim(),
    tempo,
    style: style.trim()
  };
};

const isMalformedPattern = (pattern: string): boolean => {
  if (pattern.includes('```')) {
    return true;
  }

  if (/^pattern\s*:/i.test(pattern)) {
    return true;
  }

  if (/^(here is|here's|this is)/i.test(pattern)) {
    return true;
  }

  return false;
};

const validatePattern = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.length > MAX_PATTERN_LENGTH) {
    return null;
  }

  if (isMalformedPattern(trimmed)) {
    return null;
  }

  return trimmed;
};

const extractPatternFromOpenAiResponse = (value: unknown): string | null => {
  if (!isObject(value)) {
    return null;
  }

  const response = value as OpenAiSuccessResponse;
  const content = response.choices?.[0]?.message?.content;
  return validatePattern(content);
};

export const createGenerateHandler = (deps: GenerateHandlerDependencies = {}) => {
  const fetchFn = deps.fetchFn ?? fetch;
  const getOpenAiApiKey = deps.getOpenAiApiKey ?? defaultGetOpenAiApiKey;
  const openAiUrl = deps.openAiUrl ?? 'https://api.openai.com/v1/chat/completions';
  const model = deps.model ?? 'gpt-4o-mini';

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') {
      return jsonResponse(405, { error: 'Method not allowed' });
    }

    let payload: unknown;

    try {
      payload = await request.json();
    } catch {
      return jsonResponse(422, { error: 'Invalid JSON payload' });
    }

    const input = parseAndValidatePayload(payload);

    if (!input) {
      return jsonResponse(422, {
        error: `Invalid payload. Expected { mood: string, tempo: number (${MIN_TEMPO}-${MAX_TEMPO}), style: string }`
      });
    }

    const apiKey = getOpenAiApiKey();

    if (!apiKey) {
      return jsonResponse(500, { error: 'OPENAI_API_KEY is not configured' });
    }

    const requestBody: OpenAiRequestBody = {
      model,
      messages: buildPrompt(input),
      temperature: 0.8
    };

    let upstreamResponse: Response;

    try {
      upstreamResponse = await fetchFn(openAiUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      });
    } catch {
      return jsonResponse(500, { error: 'Failed to reach OpenAI Chat Completions API' });
    }

    if (!upstreamResponse.ok) {
      return jsonResponse(500, { error: 'OpenAI Chat Completions API returned an error' });
    }

    let upstreamJson: unknown;

    try {
      upstreamJson = await upstreamResponse.json();
    } catch {
      return jsonResponse(500, { error: 'Invalid JSON response from OpenAI Chat Completions API' });
    }

    const pattern = extractPatternFromOpenAiResponse(upstreamJson);

    if (!pattern) {
      return jsonResponse(500, { error: 'OpenAI returned an invalid Strudel pattern' });
    }

    return jsonResponse(200, { pattern });
  };
};
