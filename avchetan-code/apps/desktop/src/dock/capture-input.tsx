import {
  type CommandName,
  captureText,
  LOCK_FREE_COMMANDS,
  parseCommand,
  rankCommands,
} from '@avchetan/core';
import { toAppError } from '@avchetan/shared';
import { type KeyboardEvent, type RefObject, useEffect, useState } from 'react';
import { HelpLink } from '../help-link';
import { useCaptureMutation, useRecentCaptures } from '../queries/raw-logs';
import { useSubmitKey } from '../queries/settings';
import { unlockMessage } from '../services/app-lock';
import { askQuestion, isQuestion, questionText } from '../services/ask';
import { commandDeps, rememberCapture } from '../services/commands';
import { type DockListKind, dockKey } from '../services/dock-keys';
import { DEFAULT_SUBMIT_KEY, isSubmitPress, submitHint } from '../services/submit-key';
import { useServices } from '../services-context';
import { type AskState, useDockStore } from '../stores/dock-store';
import { isHidden, useLockStatus, useUnlock } from '../use-lock';
import { openEntryDay } from './ask-panel';
import { ClipboardLine } from './clipboard-line';
import { DOCK_LIST_ID, dockRowId } from './dock-list';
import { RECENT_SHOWN } from './recent-captures';
import { undoStack, useCommand } from './use-command';
import type { VoiceUi } from './use-voice';
import { MicButton, VoiceLine } from './voice-line';
import { WindowContextLine } from './window-context-line';

/** The dock's text box. One of Enter / Shift+Enter saves (a setting); the other adds a line. */
export function CaptureInput(props: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onCaptured: () => void;
  /** Esc with nothing left to step back from: saves the draft and hides the dock. */
  onHide: () => void;
  voice: VoiceUi;
}) {
  const submitKey = useSubmitKey().data ?? DEFAULT_SUBMIT_KEY;
  const draft = useDockStore((state) => state.draft);
  const setDraft = useDockStore((state) => state.setDraft);
  const setAsk = useDockStore((state) => state.setAsk);
  const ask = useDockStore((state) => state.ask);
  const asking = ask?.status === 'asking';
  const highlight = useDockStore((state) => state.highlight);
  const setHighlight = useDockStore((state) => state.setHighlight);
  const recent = useRecentCaptures(RECENT_SHOWN).data ?? [];
  const window = useDockStore((state) => state.window);
  const clipboard = useDockStore((state) => state.clipboard);
  const setClipboard = useDockStore((state) => state.setClipboard);
  const spoken = useDockStore((state) => state.spoken);
  const setSpoken = useDockStore((state) => state.setSpoken);
  const services = useServices();
  const captureMutation = useCaptureMutation();
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const askMode = isQuestion(draft);
  const command = useCommand(draft, setDraft, highlight);
  const locked = isHidden(useLockStatus());
  const unlock = useUnlock();
  // /lock, /unlock and /settings show nothing written before, nor does the list of commands
  // while a name is being typed; they work while locked. Learned aliases aren't applied here, so
  // an alias waits for an unlock like any other command.
  const typed = command.active ? parseCommand(draft) : null;
  const lockFree =
    typed !== null &&
    (typed.command
      ? LOCK_FREE_COMMANDS.has(typed.command)
      : !typed.text && rankCommands(typed.word).length > 0);
  /** Ask and the other commands show what was written before, so they wait for an unlock. */
  const needsUnlock = locked && (askMode || (command.active && !lockFree));
  const commandPanelShown = !needsUnlock && !(locked && !lockFree);

  // The list ↑/↓ move through: the one showing under the box (dock-app.tsx).
  const listKind: DockListKind | null = command.active
    ? commandPanelShown && command.suggestions.length > 0
      ? 'commands'
      : null
    : locked
      ? null
      : ask
        ? ask.sources.length > 0
          ? 'sources'
          : null
        : recent.length > 0
          ? 'entries'
          : null;
  const listRows =
    listKind === 'commands'
      ? command.suggestions.length
      : listKind === 'sources'
        ? (ask?.sources.length ?? 0)
        : listKind === 'entries'
          ? recent.length
          : 0;
  const picked = listKind !== null && highlight !== null && highlight < listRows ? highlight : null;
  /** The command list shows its first row lit, the best match, until ↑/↓ pick another. */
  const lit = picked ?? (listKind === 'commands' ? 0 : null);
  /** What Enter runs while a command name is being typed: the best match ("/ulk" → /unlock). */
  const bestCommand = typed?.word ? command.suggestions[0] : undefined;

  // New text or another list starts again from the box.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on each change
  useEffect(() => setHighlight(null), [draft, listKind, setHighlight]);

  /** Runs only after an unlock when locked; false when the unlock didn't happen. */
  async function unlockFirst(reason: string): Promise<boolean> {
    if (!locked) return true;
    if (unlock.isPending) return false;
    return (await unlock.mutateAsync(reason)) === 'verified';
  }

  async function chooseCommand(name: CommandName) {
    if (!LOCK_FREE_COMMANDS.has(name) && !(await unlockFirst('Unlock Avchetan to run commands'))) {
      return;
    }
    await command.runNamed(name);
  }

  /** The capture box's own keys (services/dock-keys.ts). True when the key was used. */
  function onDockKey(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    const { key, shiftKey, ctrlKey, altKey, metaKey } = event;
    if (
      key === 'Escape' &&
      (props.voice.phase === 'listening' || props.voice.phase === 'starting')
    ) {
      // Esc while recording throws the recording away; the dock stays.
      event.preventDefault();
      props.voice.cancel();
      return true;
    }
    const action = dockKey(
      { key, shiftKey, ctrlKey, altKey, metaKey },
      {
        draftEmpty: !draft.trim(),
        list: listKind ? { kind: listKind, rows: listRows } : null,
        highlight: picked,
        panelOpen: ask !== null && !asking,
      },
    );
    if (action.kind === 'none') return false;
    event.preventDefault();
    switch (action.kind) {
      case 'move':
        setHighlight(action.to);
        break;
      case 'complete': {
        const name = command.suggestions[action.row];
        if (name) setDraft(`/${name} `);
        break;
      }
      case 'open':
        if (listKind === 'commands') {
          const name = command.suggestions[action.row];
          if (name) void chooseCommand(name);
        } else if (listKind === 'sources') {
          const source = ask?.sources[action.row];
          if (source) openEntryDay(services.platform, source.rawLog);
        } else {
          const rawLog = recent[action.row];
          if (rawLog) openEntryDay(services.platform, rawLog);
        }
        break;
      case 'undo':
        void unlockFirst('Unlock Avchetan to take back an entry').then((ok) =>
          ok ? command.undoLast() : undefined,
        );
        break;
      case 'close_panel':
        setAsk(null);
        break;
      case 'hide':
        props.onHide();
        break;
    }
    return true;
  }

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
    if (needsUnlock) {
      if (unlock.isPending) return;
      const outcome = await unlock.mutateAsync('Unlock Avchetan to ask or run commands');
      // The question or command runs once unlocked, as if Enter had been pressed then.
      if (outcome !== 'verified') return;
      if (askMode) return submitQuestion();
      // Already unlocked: run it directly, not through chooseCommand's unlock check again.
      return bestCommand ? command.runNamed(bestCommand) : command.submit();
    }
    if (askMode) return submitQuestion();
    // A name still being typed runs the best match, as picking it would. "/" alone does nothing.
    if (command.active) return bestCommand ? chooseCommand(bestCommand) : command.submit();
    if (!draft.trim() || captureMutation.isPending) return;
    try {
      // "//note" is saved as "/note" (docs/product/command-mode.md).
      const rawLog = await captureMutation.mutateAsync({
        text: captureText(draft),
        window,
        clipboard,
        spoken,
      });
      // /undo can take it back until Avchetan restarts.
      rememberCapture(commandDeps(services, undoStack), rawLog);
      setDraft('');
      setSpoken(false);
      // The window stays until the next shortcut; copied text belongs to this entry only.
      setClipboard(null);
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
        <span className="ml-auto">
          <MicButton voice={props.voice} />
        </span>
      </div>
      <textarea
        ref={props.inputRef}
        aria-label="What's on your mind?"
        placeholder="What's on your mind?  #tags  !private  ?question  /command"
        rows={3}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          if (!event.target.value) setSpoken(false);
        }}
        aria-controls={listKind ? DOCK_LIST_ID : undefined}
        aria-activedescendant={lit !== null ? dockRowId(lit) : undefined}
        onKeyDown={(event) => {
          if (command.active && !needsUnlock && command.onKeyDown(event)) return;
          if (onDockKey(event)) return;
          const { key, shiftKey, ctrlKey, altKey, metaKey } = event;
          const press = { key, shiftKey, ctrlKey, altKey, metaKey };
          if (isSubmitPress({ ...press, isComposing: event.nativeEvent.isComposing }, submitKey)) {
            event.preventDefault();
            void submit();
          }
        }}
        className="w-full resize-none rounded-lg border border-line bg-surface-raised px-3 py-2 text-[15px] outline-none focus:border-accent"
      />
      {needsUnlock ? (
        <div className="px-1 pt-1 text-xs text-ink-muted">
          <p>🔒 Unlock to ask or run commands. Press Enter to unlock with Windows Hello.</p>
          {unlockMessage(unlock.data ?? null) ? (
            <p role="alert" className="text-danger">
              {unlockMessage(unlock.data ?? null)} <HelpLink code="app_lock_unavailable" />
            </p>
          ) : null}
        </div>
      ) : commandPanelShown ? (
        command.panel
      ) : null}
      <VoiceLine voice={props.voice} />
      {!askMode && !command.active ? (
        <>
          <WindowContextLine />
          <ClipboardLine />
        </>
      ) : null}
      {errorCode ? (
        <p role="alert" className="px-1 pt-1 text-xs text-danger">
          Couldn't save this entry. Your text is still here; try again.{' '}
          <HelpLink code={errorCode} />
        </p>
      ) : null}
    </div>
  );
}
