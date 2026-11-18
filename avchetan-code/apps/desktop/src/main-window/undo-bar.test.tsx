// @vitest-environment happy-dom
import { ValidationError } from '@avchetan/shared';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNDO_MS, UndoProvider, useUndo } from './undo-bar';

/** A row that hides itself while its delete waits, as the Tasks page does. */
function Row({ id, commit }: { id: string; commit: () => Promise<void> }) {
  const undo = useUndo();
  if (undo.isHidden(id)) return null;
  return (
    <button type="button" onClick={() => undo.later({ key: id, message: `Deleted ${id}`, commit })}>
      Delete {id}
    </button>
  );
}

function renderRows(commits: Record<string, () => Promise<void>>) {
  return render(
    <UndoProvider>
      {Object.entries(commits).map(([id, commit]) => (
        <Row key={id} id={id} commit={commit} />
      ))}
    </UndoProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('UndoProvider', () => {
  it('hides the row and writes nothing until the time is up', async () => {
    const commit = vi.fn(async () => {});
    renderRows({ a: commit });

    fireEvent.click(screen.getByText('Delete a'));

    expect(screen.queryByText('Delete a')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Deleted a');
    await act(() => vi.advanceTimersByTimeAsync(UNDO_MS - 1));
    expect(commit).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(commit).toHaveBeenCalledOnce();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('brings the row back and never writes when undone', async () => {
    const commit = vi.fn(async () => {});
    renderRows({ a: commit });

    fireEvent.click(screen.getByText('Delete a'));
    fireEvent.click(screen.getByText('Undo'));
    await act(() => vi.advanceTimersByTimeAsync(UNDO_MS * 2));

    expect(commit).not.toHaveBeenCalled();
    expect(screen.getByText('Delete a')).toBeTruthy();
  });

  it('makes a waiting change at once when a second one comes', () => {
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    renderRows({ a: first, b: second });

    fireEvent.click(screen.getByText('Delete a'));
    fireEvent.click(screen.getByText('Delete b'));

    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('Deleted b');
  });

  it('makes a waiting change when the window closes', () => {
    const commit = vi.fn(async () => {});
    renderRows({ a: commit });

    fireEvent.click(screen.getByText('Delete a'));
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(commit).toHaveBeenCalledOnce();
  });

  it('shows why a change failed, with a way to close the message', async () => {
    const commit = vi.fn(async () => {
      throw new ValidationError('not_found', 'Task not found');
    });
    renderRows({ a: commit });

    fireEvent.click(screen.getByText('Delete a'));
    await act(() => vi.advanceTimersByTimeAsync(UNDO_MS));

    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Close'));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
