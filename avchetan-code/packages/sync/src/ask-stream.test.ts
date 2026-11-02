import { describe, expect, it } from 'vitest';
import { readAnswer } from './ask-stream';

const ID = '0192a000-0000-7000-8000-000000000001';

/** A response whose body arrives in exactly these pieces. */
function streamed(...pieces: string[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
}

const event = (data: object) => `data: ${JSON.stringify(data)}\n\n`;

describe('readAnswer', () => {
  it('follows the text and returns the end, whatever the chunk boundaries', async () => {
    const whole =
      event({ type: 'text', text: 'Your knee' }) +
      event({ type: 'text', text: 'Your knee hurt [1].' }) +
      event({
        type: 'done',
        answer: 'Your knee hurt [1].',
        sources: [{ number: 1, rawLogId: ID }],
      });
    const seen: string[] = [];

    const result = await readAnswer(
      streamed(whole.slice(0, 7), whole.slice(7, 40), whole.slice(40)),
      (text) => seen.push(text),
    );

    expect(seen).toEqual(['Your knee', 'Your knee hurt [1].']);
    expect(result).toEqual({
      answer: 'Your knee hurt [1].',
      sources: [{ number: 1, rawLogId: ID }],
    });
  });

  it('reads Windows line endings', async () => {
    const result = await readAnswer(
      streamed('data: {"type":"done","answer":"Hi","sources":[]}\r', '\n\r\n'),
      () => {},
    );

    expect(result.answer).toBe('Hi');
  });

  it('throws the hub model’s failure with its code', async () => {
    const response = streamed(
      event({ type: 'error', code: 'llm_rate_limit', message: 'Slow down' }),
    );

    await expect(readAnswer(response, () => {})).rejects.toMatchObject({ code: 'llm_rate_limit' });
  });

  it('notices an answer cut off before its end', async () => {
    const response = streamed(event({ type: 'text', text: 'Your' }));

    await expect(readAnswer(response, () => {})).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('reads the error of a refused request', async () => {
    const response = new Response(
      JSON.stringify({ error: { code: 'ask_unavailable', message: 'No model', requestId: 'r' } }),
      { status: 503 },
    );

    await expect(readAnswer(response, () => {})).rejects.toMatchObject({ code: 'ask_unavailable' });
  });
});
