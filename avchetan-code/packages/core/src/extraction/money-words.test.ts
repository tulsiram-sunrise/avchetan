import { describe, expect, it } from 'vitest';
import { spentFromWords } from './money-words';

describe('spentFromWords', () => {
  it.each([
    // How the author wrote it in v0.5.0 test build 2.
    ['I had the field ploughed today for sowing peas, which cost ₹132.', 132],
    ['bought groceries, paid ₹640', 640],
    ['paid 640 for groceries', 640],
    ['spent 640 rupees on groceries', 640],
    ['bought a phone for Rs. 1,50,000', 150000],
    ['bought a chair for Rs 2,499/-', 2499],
    ['paid $12.50 for the book', 12.5],
    ['bought milk ₹60, bread ₹40', 100],
    ['bought medicines for dad, paid ₹850. need to pay the plumber ₹1200 tomorrow', 850],
    ['auto fare 80 rs', 80],
  ])('%s → %s', (text, spent) => {
    expect(spentFromWords(text)).toBe(spent);
  });

  it.each([
    ['need to pay the plumber ₹1200 tomorrow'],
    ['got ₹500 from the client'],
    ['salary of ₹50,000 came in'],
    ['spent 2 hours on the report'],
    ['spent 20 minutes walking'],
    ['walked 5 km'],
    ['the book is ₹300'],
    ['lent ₹200 to a friend, he will pay back'],
  ])('reads nothing spent from %s', (text) => {
    expect(spentFromWords(text)).toBeNull();
  });
});
