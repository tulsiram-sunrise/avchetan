import { describe, expect, it, vi } from 'vitest';
import { NetInfoMonitor, type NetListener } from './netinfo-monitor';

function fakeSource() {
  let emit: NetListener = () => {};
  const monitor = new NetInfoMonitor((listener) => {
    emit = listener;
    return () => {};
  });
  return { monitor, emit: (isConnected: boolean | null) => emit({ isConnected }) };
}

describe('NetInfoMonitor', () => {
  it('starts online and follows the connection', () => {
    const { monitor, emit } = fakeSource();
    expect(monitor.isOnline()).toBe(true);
    emit(false);
    expect(monitor.isOnline()).toBe(false);
    emit(true);
    expect(monitor.isOnline()).toBe(true);
  });

  it('counts an unknown state as online', () => {
    const { monitor, emit } = fakeSource();
    emit(false);
    emit(null);
    expect(monitor.isOnline()).toBe(true);
  });

  it('tells listeners only about changes, until they unsubscribe', () => {
    const { monitor, emit } = fakeSource();
    const listener = vi.fn();
    const unsubscribe = monitor.subscribe(listener);
    emit(true);
    emit(false);
    emit(false);
    expect(listener.mock.calls).toEqual([[false]]);
    unsubscribe();
    emit(true);
    expect(listener).toHaveBeenCalledOnce();
  });
});
