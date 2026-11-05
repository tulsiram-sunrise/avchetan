import { describe, expect, it } from 'vitest';
import { CATEGORY_PALETTE, categoryColor } from './category-colors';

describe('category colours', () => {
  it('gives every seed its own colour', () => {
    const seeds = ['work', 'workout', 'diet', 'health', 'reflection', 'other'];
    const colors = seeds.map((slug) => categoryColor({ slug }, 'light'));
    expect(new Set(colors).size).toBe(seeds.length);
  });

  it('picks the same palette colour for the same slug, in both schemes', () => {
    const light = categoryColor({ slug: 'guitar-practice' }, 'light');
    const dark = categoryColor({ slug: 'guitar-practice' }, 'dark');
    expect(categoryColor({ slug: 'guitar-practice' }, 'light')).toBe(light);
    expect(CATEGORY_PALETTE.findIndex((s) => s.light === light)).toBe(
      CATEGORY_PALETTE.findIndex((s) => s.dark === dark),
    );
  });

  it('uses a category colour of its own when it is a valid hex colour', () => {
    expect(categoryColor({ slug: 'work', color: '#123456' }, 'dark')).toBe('#123456');
    expect(categoryColor({ slug: 'work', color: 'red' }, 'light')).toBe('#2563eb');
  });
});
