import { LlmError, SyncError } from '@avchetan/shared';
import { type AskEvent, askEventSchema, errorResponseSchema, type HubAskResult } from './protocol';

/** The events in a server-sent event stream: `data:` lines, blocks split by a blank line. */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<AskEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    // On the whole buffer, so a \r\n split across two chunks is still one line end.
    buffer = (buffer + decoder.decode(value, { stream: !done })).replace(/\r\n/g, '\n');
    let end = buffer.indexOf('\n\n');
    while (end !== -1) {
      const data = buffer
        .slice(0, end)
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      buffer = buffer.slice(end + 2);
      if (data) {
        const event = askEventSchema.safeParse(JSON.parse(data));
        if (!event.success)
          throw new SyncError('bad_response', 'The hub sent something unexpected');
        yield event.data;
      }
      end = buffer.indexOf('\n\n');
    }
    if (done) return;
  }
}

/** Follows an answer from `POST /v1/ask` to its end, passing the text along as it grows. */
export async function readAnswer(
  response: Response,
  onText: (text: string) => void,
): Promise<HubAskResult> {
  if (!response.ok || !response.body) {
    const failure = errorResponseSchema.safeParse(await response.json().catch(() => undefined));
    throw new SyncError(
      failure.success ? failure.data.error.code : 'server_error',
      failure.success ? failure.data.error.message : 'The hub sent an error',
      { details: { status: response.status } },
    );
  }
  for await (const event of readEvents(response.body)) {
    if (event.type === 'text') onText(event.text);
    else if (event.type === 'done') return { answer: event.answer, sources: event.sources };
    else {
      // The hub's model failed: the same codes, and fixes, as a model on this device.
      const ErrorClass = event.code.startsWith('llm_') ? LlmError : SyncError;
      throw new ErrorClass(event.code, event.message);
    }
  }
  throw new SyncError('bad_response', 'The hub stopped before finishing the answer');
}
