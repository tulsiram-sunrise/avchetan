// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { followTextSize, rootFontSize } from './text-size';

describe('rootFontSize', () => {
  it('follows Windows from 100% to 225%', () => {
    expect(rootFontSize(1)).toBe('100%');
    expect(rootFontSize(1.25)).toBe('125%');
    expect(rootFontSize(2.25)).toBe('225%');
  });

  it('takes anything else as 100% or the most', () => {
    expect(rootFontSize(0.5)).toBe('100%');
    expect(rootFontSize(Number.NaN)).toBe('100%');
    expect(rootFontSize(4)).toBe('225%');
  });
});

describe('followTextSize', () => {
  it('applies at start and again when the window comes back', async () => {
    let factor = 1.5;
    const root = document.createElement('div');
    await followTextSize(async () => factor, root);
    expect(root.style.fontSize).toBe('150%');

    factor = 2;
    window.dispatchEvent(new Event('focus'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.style.fontSize).toBe('200%');
  });

  it('keeps the page as it is when the size can’t be read', async () => {
    const root = document.createElement('div');
    await followTextSize(async () => {
      throw new Error('no shell');
    }, root);
    expect(root.style.fontSize).toBe('');
  });
});
