/** Words too common to say two texts are about the same thing. */
const COMMON = new Set(
  'the and for with that this then from have had has was were are but not you your its into out about after before just very some today yesterday tomorrow morning evening night'.split(
    ' ',
  ),
);

/** The words that say what a text is about: lowercased, 3 letters or more, common ones left out. */
export function meaningfulWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3 && !COMMON.has(word)),
  );
}

export function sharedCount(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared;
}
