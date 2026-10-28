import { toAppError } from '@avchetan/shared';
import { type RefObject, useState } from 'react';
import { HelpLink } from '../help-link';
import { useCaptureMutation } from '../queries/raw-logs';
import { useSubmitKey } from '../queries/settings';
import { DEFAULT_SUBMIT_KEY, isSubmitPress, submitHint } from '../services/submit-key';
import { useDockStore } from '../stores/dock-store';

/** The dock's text box. One of Enter / Shift+Enter saves (a setting); the other adds a line. */
export function CaptureInput(props: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onCaptured: () => void;
}) {
  const submitKey = useSubmitKey().data ?? DEFAULT_SUBMIT_KEY;
  const draft = useDockStore((state) => state.draft);
  const setDraft = useDockStore((state) => state.setDraft);
  const captureMutation = useCaptureMutation();
  const [errorCode, setErrorCode] = useState<string | null>(null);

  async function submit() {
    if (!draft.trim() || captureMutation.isPending) return;
    try {
      await captureMutation.mutateAsync(draft);
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
          Capture
        </span>
        <span>{submitHint(submitKey)} · Esc to close</span>
      </div>
      <textarea
        ref={props.inputRef}
        aria-label="What's on your mind?"
        placeholder="What's on your mind?  #tags  !private"
        rows={3}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          const { key, shiftKey, ctrlKey, altKey, metaKey } = event;
          const press = { key, shiftKey, ctrlKey, altKey, metaKey };
          if (isSubmitPress({ ...press, isComposing: event.nativeEvent.isComposing }, submitKey)) {
            event.preventDefault();
            void submit();
          }
        }}
        className="w-full resize-none rounded-lg border border-line bg-surface-raised px-3 py-2 text-[15px] outline-none focus:border-accent"
      />
      {errorCode ? (
        <p role="alert" className="px-1 pt-1 text-xs text-danger">
          Couldn't save this entry. Your text is still here; try again.{' '}
          <HelpLink code={errorCode} />
        </p>
      ) : null}
    </div>
  );
}
