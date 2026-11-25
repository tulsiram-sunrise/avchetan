import { describe, expect, it } from 'vitest';
import { isAlreadyPaid, spentFromWords } from './money-words';

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
    // v0.5.0 test build 5.
    ['paid 200 for lunch and 150 for a cab', 350],
    ['paid 200 for lunch, 150 for a cab', 350],
    ['went to the city by bus ₹90, lunch there ₹150', 240],
    ['bought 3 for ₹60', 60],
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
    ['received ₹2000 from my cousin'],
    ['spent 2 hours and 30 minutes on the report'],
  ])('reads nothing spent from %s', (text) => {
    expect(spentFromWords(text)).toBeNull();
  });
});

describe('isAlreadyPaid', () => {
  it.each([
    ['Pay the tailor ₹2500', 'the ticket took ₹80 and ₹2500 to the tailor'],
    ['Paid tax office fees', 'auto fare took ₹80 and ₹2500 to the consultant'],
    ["Get the electrician's payment back", 'gave ₹500 to the electrician for the fan repair'],
    ['Receive ₹2000 from cousin', 'received ₹2000 from my cousin for the gift'],
  ])('drops "%s" for "%s"', (task, entry) => {
    expect(isAlreadyPaid(task, entry)).toBe(true);
  });

  it.each([
    ['Pay the internet bill ₹700', 'bought milk ₹60, need to pay the internet bill ₹700 tomorrow'],
    ['Pay the plumber', 'paid ₹200 for parts, the plumber is due on Friday'],
    ['Get ₹200 back from a friend', 'lent ₹200 to a friend'],
    ['Call the electrician', 'gave ₹500 to the electrician'],
    ['Pay the rent', 'walked 5 km'],
  ])('keeps "%s" for "%s"', (task, entry) => {
    expect(isAlreadyPaid(task, entry)).toBe(false);
  });
});
