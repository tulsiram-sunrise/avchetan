/** Splits a raw log's `code: message`, as stored by the pending processor. */
export function parseLastError(lastError: string): { code: string; message: string } {
  const [code = '', ...message] = lastError.split(': ');
  return { code, message: message.join(': ') };
}
