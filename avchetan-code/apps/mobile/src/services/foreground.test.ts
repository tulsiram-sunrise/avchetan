import { describe, expect, it, vi } from 'vitest';
import { watchAppState } from './foreground';

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

describe('watchAppState', () => {
  it('runs onActive only when the app becomes active', () => {
    const { source, emit } = fakeAppState();
    const onActive = vi.fn();

    watchAppState(source, { onActive, onLeave: () => {} });
    emit('background');
    emit('inactive');
    expect(onActive).not.toHaveBeenCalled();

    emit('active');
    expect(onActive).toHaveBeenCalledOnce();
  });

  it('runs onLeave only when the app goes to the background', () => {
    const { source, emit } = fakeAppState();
    const onLeave = vi.fn();

    watchAppState(source, { onActive: () => {}, onLeave });
    emit('inactive');
    emit('active');
    expect(onLeave).not.toHaveBeenCalled();

    emit('background');
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it('stops watching when cancelled', () => {
    const { source, remove } = fakeAppState();

    watchAppState(source, { onActive: () => {}, onLeave: () => {} })();

    expect(remove).toHaveBeenCalledOnce();
  });
});
