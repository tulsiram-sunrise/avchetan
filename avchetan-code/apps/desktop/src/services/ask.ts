const ASK_PREFIX = '?';

export function isQuestion(text: string): boolean {
  return text.trimStart().startsWith(ASK_PREFIX);
}

export function questionText(text: string): string {
  return text.trimStart().slice(ASK_PREFIX.length).trim();
}
