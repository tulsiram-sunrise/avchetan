/**
 * Money spent read straight from the words, for when the model misses it (v0.5.0 test build 2: a
 * small model left "which cost ₹132" out of the activity). Only clear statements count: an amount
 * marked as money (₹132, Rs 500, 640 rupees) or right after paid/spent/cost, in a sentence about
 * paying. Money still to pay, owed or received is not spent.
 */

const NUMBER = String.raw`(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)`;
const BEFORE = String.raw`(?:[₹$€£]|\b(?:rs|inr|usd|eur)\b\.?)\s*`;
const AFTER = String.raw`\s*(?:\/-|(?:rs|inr|rupees?|rupaye|rupay|dollars?|euros?)\b)`;
const UNIT_WORDS = String.raw`(?:h|hrs?|hours?|mins?|minutes?|km|kms|kg|g|ml|l|steps?|times|days?|weeks?|months?|years?|am|pm|%)`;

const AMOUNTS = [
  new RegExp(`${BEFORE}${NUMBER}`, 'gu'),
  new RegExp(`${NUMBER}${AFTER}`, 'gu'),
  new RegExp(
    String.raw`\b(?:paid|spent|cost|costs|costing)\s+(?:(?:about|around|only|me|us|just)\s+)*${NUMBER}(?![\d.,]*\s*${UNIT_WORDS}\b)`,
    'gu',
  ),
];

const SPENDING =
  /\b(?:paid|pay|spent|spend|cost|costs|costing|bought|buy|purchased|purchase|kharch\w*|diye|diya|bill|fees?|fare|recharged?)\b/;
/** Money still to pay, owed, lent or coming in: never "spent". */
const NOT_SPENT =
  /\b(?:need to|needs to|have to|has to|must|will|going to|gonna|tomorrow|owe|owes|owed|due|later|remind|pending|lend|lent|borrow\w*|loan|got|received|earned|salary|income|refund\w*|cashback|sold|selling)\b/;

const MAX_SPENT = 1_000_000_000;

function amountsIn(clause: string): number[] {
  const found = new Map<number, number>();
  for (const pattern of AMOUNTS) {
    for (const match of clause.matchAll(pattern)) {
      const value = Number(match[1]?.replaceAll(',', ''));
      // The same amount matched twice ("paid ₹640") is one amount: keyed by where it starts.
      const at = (match.index ?? 0) + match[0].indexOf(match[1] ?? '');
      if (value > 0 && value <= MAX_SPENT) found.set(at, value);
    }
  }
  return [...found.values()];
}

/**
 * The amount spent, when the entry clearly says so; null otherwise. Amounts in a sentence about
 * paying add up ("bought milk ₹60, bread ₹40" is 100); one in a clause about owing or receiving
 * doesn't count.
 */
export function spentFromWords(text: string): number | null {
  const lower = text.toLowerCase();
  if (!SPENDING.test(lower)) return null;
  // A comma or period between digits is part of the number (₹1,200, ₹99.50), as is "Rs.".
  const clauses = lower.split(/[;!?\n]|,(?!\d)|(?<!\brs)\.(?!\d)|\bthen\b|\bbut\b/);
  let total = 0;
  for (const clause of clauses) {
    if (NOT_SPENT.test(clause)) continue;
    for (const amount of amountsIn(clause)) total += amount;
  }
  return total > 0 ? Math.round(total * 100) / 100 : null;
}
