import { captureText } from '@avchetan/core';
import { toAppError } from '@avchetan/shared';
import { type RefObject, useState } from 'react';
import { HelpLink } from '../help-link';
import { useCaptureMutation } from '../queries/raw-logs';
import { useSubmitKey } from '../queries/settings';
import { askQuestion, isQuestion, questionText } from '../services/ask';
import { DEFAULT_SUBMIT_KEY, isSubmitPress, submitHint } from '../services/submit-key';
import { useServices } from '../services-context';
import { type AskState, useDockStore } from '../stores/dock-store';
import { useCommand } from './use-command';

/** The dock's text box. One of Enter / Shift+Enter saves (a setting); the other adds a line. */
export function CaptureInput(props: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onCaptured: () => void;
}) {
  const submitKey = useSubmitKey().data ?? DEFAULT_SUBMIT_KEY;
  const draft = useDockStore((state) => state.draft);
  const setDraft = useDockStore((state) => state.setDraft);
  const setAsk = useDockStore((state) => state.setAsk);
  const asking = useDockStore((state) => state.ask?.status === 'asking');
  const services = useServices();
  const captureMutation = useCaptureMutation();
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const askMode = isQuestion(draft);
  const command = useCommand(draft, setDraft);

  /** Never saved as an entry: a question leaves the log untouched. */
  async function submitQuestion() {
    const question = questionText(draft);
    if (!question || asking) return;
    setDraft('');
    props.onCaptured();
    const base: AskState = { question, answer: '', sources: [], status: 'asking', error: null };
    setAsk(base);
    try {
      const result = await askQuestion(services, question, (answer) => setAsk({ ...base, answer }));
      setAsk({ ...base, ...result, status: 'done' });
    } catch (error) {
      const { code, message } = toAppError(error);
      setAsk({ ...base, status: 'failed', error: { code, message } });
    }
  }

  async function submit() {
    if (askMode) return submitQuestion();
    if (command.active) return command.submit();
    if (!draft.trim() || captureMutation.isPending) return;
    try {
      // "//note" is saved as "/note" (docs/product/command-mode.md).
      await captureMutation.mutateAsync(captureText(draft));
      setDraft('');
      setErrorCode(null);
      props.onCaptured();
    } catch (error) {
      setErrorCode(toAppError(error).code);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2 px-1 pb-1 text-xs text-ink-muted">
        <span className="rounded-full bg-accent/15 px-2 py-0.5 font-medium text-accent">
          {askMode ? 'Ask' : command.active ? 'Command' : 'Capture'}
        </span>
        <span>
          {submitHint(submitKey, askMode ? 'ask' : command.active ? 'run' : 'save')} · Esc to close
        </span>
      </div>
      <textarea
        ref={props.inputRef}
        aria-label="What's on your mind?"
        placeholder="What's on your mind?  #tags  !private  ?question  /command"
        rows={3}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (command.active && command.onKeyDown(event)) return;
          const { key, shiftKey, ctrlKey, altKey, metaKey } = event;
          const press = { key, shiftKey, ctrlKey, altKey, metaKey };
          if (isSubmitPress({ ...press, isComposing: event.nativeEvent.isComposing }, submitKey)) {
            event.preventDefault();
            void submit();
          }
        }}
        className="w-full resize-none rounded-lg border border-line bg-surface-raised px-3 py-2 text-[15px] outline-none focus:border-accent"
      />
      {command.panel}
      {errorCode ? (
        <p role="alert" className="px-1 pt-1 text-xs text-danger">
          Couldn't save this entry. Your text is still here; try again.{' '}
          <HelpLink code={errorCode} />
        </p>
      ) : null}
    </div>
  );
}
