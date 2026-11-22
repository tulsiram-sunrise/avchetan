// @vitest-environment happy-dom
import { configureLogging, LlmError, type LogRecord } from '@avchetan/shared';
import { createMemoryLogSink } from '@avchetan/shared/testing';
import { QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HelpLink } from './help-link';
import { createQueryClient } from './query-client';

const secret = 'met a made-up friend about the loan';
let records: LogRecord[];

beforeEach(() => {
  const memory = createMemoryLogSink();
  records = memory.records;
  configureLogging({ sink: memory.sink, level: 'debug' });
});
afterEach(cleanup);

function TestButton() {
  const test = useMutation({
    mutationFn: async () => {
      throw new LlmError('llm_unavailable', `could not be reached reading "${secret}"`, {
        details: { status: 503, provider: 'google' },
      });
    },
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once, like a press.
  useEffect(() => test.mutate(), []);
  return test.error ? <HelpLink code="llm_unavailable" /> : null;
}

function Read() {
  useQuery({
    queryKey: ['search', secret],
    queryFn: async () => {
      throw new TypeError(`bad input "${secret}"`);
    },
  });
  return null;
}

describe('the query client', () => {
  it('logs a failed action with its code and where it was thrown, never its text', async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <TestButton />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(records.map((r) => r.message)).toContain('error shown'));
    expect(records.find((r) => r.message === 'action failed')).toMatchObject({
      level: 'error',
      fields: {
        code: 'llm_unavailable',
        details: { status: 503, provider: 'google' },
        at: expect.stringContaining('query-client.test.tsx'),
      },
    });
    expect(records.find((r) => r.message === 'error shown')?.fields).toEqual({
      code: 'llm_unavailable',
    });
    expect(JSON.stringify(records)).not.toContain('made-up friend');
  });

  it('logs a failed read by its name only', async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <Read />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(records.map((r) => r.message)).toContain('read failed'));
    expect(records.find((r) => r.message === 'read failed')?.fields).toMatchObject({
      query: 'search',
      code: 'internal',
      error: 'TypeError',
    });
    expect(JSON.stringify(records)).not.toContain('made-up friend');
  });
});
