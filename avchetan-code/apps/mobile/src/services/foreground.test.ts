import { describe, expect, it, vi } from 'vitest';
import { watchForeground } from './foreground';

function fakeAppState() {
  let listener: (state: string) => void = () => {};
  const remove = vi.fn();
  return {
    remove,
    emit: (state: string) => listener(state),
    source: {
      addEventListener: (_type: 'change', next: (state: string) => void) => {
        listener = next;
        return { remove };
      },
    },
  };
}

describe('watchForeground', () => {
  it('runs only when the app becomes active', () => {
    const { source, emit } = fakeAppState();
    const onActive = vi.fn();

    watchForeground(source, onActive);
    emit('background');
    emit('inactive');
    expect(onActive).not.toHaveBeenCalled();

    emit('active');
    expect(onActive).toHaveBeenCalledOnce();
  });

  it('stops watching when cancelled', () => {
    const { source, remove } = fakeAppState();

    watchForeground(source, () => {})();

    expect(remove).toHaveBeenCalledOnce();
  });
});
