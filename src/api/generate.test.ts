/* @vitest-environment node */

import { describe, expect, it, vi } from 'vitest';
import { createGenerateHandler } from './generate';

const createPostRequest = (body: unknown): Request => {
  return new Request('http://localhost/api/generate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });
};

describe('createGenerateHandler', () => {
  it('accepts POST /api/generate with { mood, tempo, style } and returns 200 + pattern', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '  stack(s("bd ~ ~ sd"), s("~ hh ~ hh")).cpm(90)  '
              }
            }
          ]
        }),
        { status: 200 }
      )
    );

    const handler = createGenerateHandler({
      fetchFn,
      getOpenAiApiKey: () => 'env-secret-key'
    });

    const response = await handler(createPostRequest({ mood: 'chill', tempo: 90, style: 'jazz' }));
    const payload = (await response.json()) as { pattern: string };

    expect(response.status).toBe(200);
    expect(payload).toEqual({ pattern: 'stack(s("bd ~ ~ sd"), s("~ hh ~ hh")).cpm(90)' });
  });

  it('rejects invalid payloads with 422 and { error }', async () => {
    const handler = createGenerateHandler({
      fetchFn: vi.fn(),
      getOpenAiApiKey: () => 'env-secret-key'
    });

    const missingFieldResponse = await handler(createPostRequest({ mood: 'chill', tempo: 90 }));
    const wrongTypeResponse = await handler(createPostRequest({ mood: 'chill', tempo: '90', style: 'jazz' }));
    const invalidRangeResponse = await handler(
      createPostRequest({ mood: 'chill', tempo: 200, style: 'jazz' })
    );

    expect(missingFieldResponse.status).toBe(422);
    expect((await missingFieldResponse.json()) as { error: string }).toHaveProperty('error');

    expect(wrongTypeResponse.status).toBe(422);
    expect((await wrongTypeResponse.json()) as { error: string }).toHaveProperty('error');

    expect(invalidRangeResponse.status).toBe(422);
    expect((await invalidRangeResponse.json()) as { error: string }).toHaveProperty('error');
  });

  it('reads OPENAI_API_KEY from server environment getter, not request body', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 's("bd ~ sd ~").cpm(88)' } }]
        }),
        { status: 200 }
      )
    );

    const handler = createGenerateHandler({
      fetchFn,
      getOpenAiApiKey: () => 'env-only-key'
    });

    await handler(
      createPostRequest({
        mood: 'focus',
        tempo: 88,
        style: 'ambient',
        OPENAI_API_KEY: 'from-request-should-be-ignored'
      })
    );

    const call = fetchFn.mock.calls[0] as [string, RequestInit];
    const headers = call[1].headers as Record<string, string>;

    expect(headers.authorization).toBe('Bearer env-only-key');
    expect(headers.authorization).not.toContain('from-request-should-be-ignored');
  });

  it('sends prompt instructions requiring only a Strudel pattern string', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 's("bd hh sd hh").cpm(96)' } }]
        }),
        { status: 200 }
      )
    );

    const handler = createGenerateHandler({
      fetchFn,
      getOpenAiApiKey: () => 'env-secret-key'
    });

    await handler(createPostRequest({ mood: 'warm', tempo: 96, style: 'dusty' }));

    const call = fetchFn.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(call[1].body as string) as {
      messages: Array<{ content: string }>;
    };

    expect(body.messages[0].content).toContain('Return only a valid Strudel pattern string');
    expect(body.messages[0].content).toContain('No markdown');
    expect(body.messages[1].content).toContain('Return only the pattern');
  });

  it('returns 500 with { error } on OpenAI failures and invalid/malformed outputs', async () => {
    const upstreamErrorHandler = createGenerateHandler({
      fetchFn: vi.fn().mockResolvedValue(new Response('upstream error', { status: 500 })),
      getOpenAiApiKey: () => 'env-secret-key'
    });

    const invalidResponseShapeHandler = createGenerateHandler({
      fetchFn: vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 })),
      getOpenAiApiKey: () => 'env-secret-key'
    });

    const malformedOutputHandler = createGenerateHandler({
      fetchFn: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '```\npattern: s("bd")\n```' } }]
          }),
          { status: 200 }
        )
      ),
      getOpenAiApiKey: () => 'env-secret-key'
    });

    const tooLongPatternHandler = createGenerateHandler({
      fetchFn: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: `s("${'bd '.repeat(300)}")` } }]
          }),
          { status: 200 }
        )
      ),
      getOpenAiApiKey: () => 'env-secret-key'
    });

    const req = createPostRequest({ mood: 'chill', tempo: 90, style: 'jazz' });

    const upstreamErrorResponse = await upstreamErrorHandler(req.clone());
    const invalidResponseShape = await invalidResponseShapeHandler(req.clone());
    const malformedOutput = await malformedOutputHandler(req.clone());
    const tooLongPattern = await tooLongPatternHandler(req.clone());

    expect(upstreamErrorResponse.status).toBe(500);
    expect((await upstreamErrorResponse.json()) as { error: string }).toHaveProperty('error');

    expect(invalidResponseShape.status).toBe(500);
    expect((await invalidResponseShape.json()) as { error: string }).toHaveProperty('error');

    expect(malformedOutput.status).toBe(500);
    expect((await malformedOutput.json()) as { error: string }).toHaveProperty('error');

    expect(tooLongPattern.status).toBe(500);
    expect((await tooLongPattern.json()) as { error: string }).toHaveProperty('error');
  });
});
