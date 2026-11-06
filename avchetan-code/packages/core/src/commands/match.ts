import { meaningfulWords, sharedCount } from '../normalize/words';

type OpenTask = { id: string; title: string; dueDate: string | null; createdAt: string };

export type TaskMatch<T extends OpenTask> =
  | { kind: 'none' }
  | { kind: 'one'; task: T }
  /** Two or more match about equally; the person picks. Best first. */
  | { kind: 'several'; tasks: T[] };

const MAX_CHOICES = 5;

/**
 * The open task `/done <words>` means: most words shared with its title. A word also counts when
 * a title word starts with it ("foam" → "foam-roll", "plumb" → "plumber"). Ties go to the task
 * due first, then the newest; equal best scores are left for the person to pick.
 */
export function matchOpenTask<T extends OpenTask>(text: string, tasks: readonly T[]): TaskMatch<T> {
  const wanted = meaningfulWords(text);
  if (wanted.size === 0) return { kind: 'none' };
  const scored = tasks
    .map((task) => {
      const titleWords = meaningfulWords(task.title);
      let score = sharedCount(wanted, titleWords);
      for (const word of wanted) {
        if (titleWords.has(word)) continue;
        if ([...titleWords].some((title) => title.startsWith(word))) score += 1;
      }
      return { task, score };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.task.dueDate ?? '9999').localeCompare(b.task.dueDate ?? '9999') ||
        b.task.createdAt.localeCompare(a.task.createdAt),
    );
  const [best, second] = scored;
  if (!best) return { kind: 'none' };
  if (!second || second.score < best.score) return { kind: 'one', task: best.task };
  return {
    kind: 'several',
    tasks: scored
      .filter(({ score }) => score === best.score)
      .slice(0, MAX_CHOICES)
      .map(({ task }) => task),
  };
}
