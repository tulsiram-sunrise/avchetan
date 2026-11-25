/**
 * Money spent read straight from the words, for when the model misses it (v0.5.0 test build 2: a
 * small model left "which cost ₹132" out of the activity). Only clear statements count: an amount
 * marked as money (₹132, Rs 500, 640 rupees) or right after paid/spent/cost/gave, in a sentence
 * about paying. Money still to pay, owed or received is not spent.
 */

const NUMBER = String.raw`(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)`;
const BEFORE = String.raw`(?:[₹$€£]|\b(?:rs|inr|usd|eur)\b\.?)\s*`;
const AFTER = String.raw`\s*(?:\/-|(?:rs|inr|rupees?|rupaye|rupay|dollars?|euros?)\b)`;
const UNIT_WORDS = String.raw`(?:h|hrs?|hours?|mins?|minutes?|km|kms|kg|g|ml|l|steps?|times|days?|weeks?|months?|years?|am|pm|%)`;

const AMOUNTS = [
  new RegExp(`${BEFORE}${NUMBER}`, 'gu'),
  new RegExp(`${NUMBER}${AFTER}`, 'gu'),
  new RegExp(
    String.raw`\b(?:paid|spent|cost|costs|costing|gave)\s+(?:(?:about|around|only|me|us|just)\s+)*${NUMBER}(?![\d.,]*\s*${UNIT_WORDS}\b)`,
    'gu',
  ),
];

/**
 * A plain number listed after an amount paid: "paid 200 for lunch and 150 for a cab" is 350
 * (test build 5). Counted only next to an amount that is clearly money, and only when "for" or
 * "on" follows it, so "3 for ₹60" adds nothing of its own.
 */
const LISTED = new RegExp(
  String.raw`(?:^|\band\b|&|\+)\s*${NUMBER}(?=\s+(?:for|on)\s+(?![\d₹$€£]|rs\b))`,
  'gu',
);

/**
 * Words about paying, or what money is commonly paid for ("bus ₹90, lunch ₹150", test build 5).
 * "took" and "gave" count too ("the ticket took ₹80, gave ₹2500 to the tailor", test build 3);
 * an amount still has to be marked as money, or follow paid/spent/cost/gave, so "took 2 hours"
 * adds nothing, and "the book is ₹300" isn't about paying.
 */
const SPENDING =
  /\b(?:paid|pay|spent|spend|cost|costs|costing|bought|buy|purchased|purchase|took|gave|given|kharch\w*|diye|diya|bill|fees?|fare|recharged?|tickets?|bus|auto|rickshaw|taxi|cab|train|metro|petrol|diesel|fuel|lunch|dinner|breakfast|snacks?|tea|coffee|meals?|food|groceries|grocery|vegetables|fruits?|milk|rent|medicines?)\b/;
/** Money still to pay, owed or lent: a task about it may be right. */
const STILL_OWED =
  /\b(?:need to|needs to|have to|has to|must|will|going to|gonna|tomorrow|owe|owes|owed|due|later|remind|pending|lend|lent|borrow\w*|loan)\b/;
/** Money that came in: never "spent". */
const CAME_IN = /\b(?:got|received|earned|salary|income|refund\w*|cashback|sold|selling)\b/;
/** A task about money: paying, being paid, getting it back. */
const ABOUT_MONEY = /\b(?:pay|paid|payment|fees?|refund|money|receive|received)\b/;

const MAX_SPENT = 1_000_000_000;

function amountsIn(clause: string, listed = false): number[] {
  const found = new Map<number, number>();
  for (const pattern of listed ? [...AMOUNTS, LISTED] : AMOUNTS) {
    for (const match of clause.matchAll(pattern)) {
      const value = Number(match[1]?.replaceAll(',', ''));
      // The same amount matched twice ("paid ₹640") is one amount: keyed by where it starts.
      const at = (match.index ?? 0) + match[0].indexOf(match[1] ?? '');
      if (value > 0 && value <= MAX_SPENT) found.set(at, value);
    }
  }
  return [...found.values()];
}

type Money = { paid: number[]; owed: number[]; cameIn: number[] };

/** The amounts the entry says were paid, the ones still owed or due, and the ones received. */
function moneyIn(text: string): Money {
  const lower = text.toLowerCase();
  const paying = SPENDING.test(lower);
  // A comma or period between digits is part of the number (₹1,200, ₹99.50), as is "Rs.".
  const clauses = lower.split(/[;!?\n]|,(?!\d)|(?<!\brs)\.(?!\d)|\bthen\b|\bbut\b/);
  const money: Money = { paid: [], owed: [], cameIn: [] };
  const paidClauses: string[] = [];
  for (const clause of clauses) {
    const amounts = amountsIn(clause);
    if (STILL_OWED.test(clause)) money.owed.push(...amounts);
    else if (CAME_IN.test(clause)) money.cameIn.push(...amounts);
    else if (paying) paidClauses.push(clause);
  }
  const clearlyPaid = paidClauses.some((clause) => amountsIn(clause).length > 0);
  for (const clause of paidClauses) money.paid.push(...amountsIn(clause, clearlyPaid));
  return money;
}

/**
 * The amount spent, when the entry clearly says so; null otherwise. Amounts in a sentence about
 * paying add up ("bought milk ₹60, bread ₹40" is 100); one in a clause about owing or receiving
 * doesn't count.
 */
export function spentFromWords(text: string): number | null {
  const total = moneyIn(text).paid.reduce((sum, amount) => sum + amount, 0);
  return total > 0 ? Math.round(total * 100) / 100 : null;
}

/**
 * Whether a task the model made is only money the entry says was already paid or received ("₹2500
 * to the tailor" turned into "Pay the tailor ₹2500", test build 3; "received ₹2000" into "Receive
 * ₹2000", test build 5). Every amount in the task has to be one the entry paid or received, and
 * none of them one it still owes. A money task with no amount ("Paid the tax office fees", "Get
 * the payment back") goes too, when the entry only paid or received money and nothing is due.
 */
export function isAlreadyPaid(task: string, entry: string): boolean {
  const lower = task.toLowerCase();
  const { paid, owed, cameIn } = moneyIn(entry);
  const settled = [...paid, ...cameIn];
  const amounts = amountsIn(lower);
  if (amounts.length > 0) {
    return amounts.every((amount) => settled.includes(amount) && !owed.includes(amount));
  }
  return (
    ABOUT_MONEY.test(lower) &&
    settled.length > 0 &&
    owed.length === 0 &&
    !STILL_OWED.test(entry.toLowerCase())
  );
}
