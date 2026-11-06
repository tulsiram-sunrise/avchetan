import { describe, expect, it } from 'vitest';
import {
  appMatches,
  type ContextRuleInput,
  DEFAULT_CONTEXT_SETTINGS,
  filterContext,
  matchRules,
  parseTitlePattern,
  ruleMatchesOf,
  ruleOutcome,
  windowContextOf,
} from './window-context';

const NOW = '2026-11-07T10:00:00.000Z';
const editor = {
  app: 'Code.exe',
  app_name: 'Visual Studio Code',
  window_title: 'api.ts — my-project — Visual Studio Code',
};

const rule = (overrides: Partial<ContextRuleInput>): ContextRuleInput => ({
  id: 'rule-1',
  appPattern: 'Code.exe',
  titlePattern: null,
  projectId: null,
  tagPaths: [],
  ...overrides,
});

describe('filterContext', () => {
  it('keeps the app and title of an ordinary window', () => {
    expect(filterContext(editor, DEFAULT_CONTEXT_SETTINGS, NOW)).toEqual(editor);
  });

  it('keeps nothing when off, paused, or the app is on the deny-list', () => {
    expect(filterContext(editor, { ...DEFAULT_CONTEXT_SETTINGS, enabled: false }, NOW)).toBeNull();
    const paused = { ...DEFAULT_CONTEXT_SETTINGS, pausedUntil: '2026-11-07T10:30:00.000Z' };
    expect(filterContext(editor, paused, NOW)).toBeNull();
    const vault = { app: 'bitwarden.EXE', app_name: 'Bitwarden', window_title: 'Vault' };
    expect(filterContext(vault, DEFAULT_CONTEXT_SETTINGS, NOW)).toBeNull();
  });

  it('records again once the pause is over', () => {
    const ended = { ...DEFAULT_CONTEXT_SETTINGS, pausedUntil: '2026-11-07T09:59:59.999Z' };
    expect(filterContext(editor, ended, NOW)).toEqual(editor);
  });

  it('keeps only the name of a browser, unless page titles are allowed', () => {
    const page = { app: 'msedge.exe', app_name: 'Microsoft Edge', window_title: 'My bank' };
    expect(filterContext(page, DEFAULT_CONTEXT_SETTINGS, NOW)).toEqual({
      app: 'msedge.exe',
      app_name: 'Microsoft Edge',
    });
    const allowed = { ...DEFAULT_CONTEXT_SETTINGS, browserTitles: true };
    expect(filterContext(page, allowed, NOW)).toEqual(page);
  });

  it('shortens long titles and names the app by its file name when it has no description', () => {
    const long = { app: 'tool.exe', app_name: ' ', window_title: 'x'.repeat(500) };
    const kept = filterContext(long, DEFAULT_CONTEXT_SETTINGS, NOW);
    expect(kept?.app_name).toBe('tool');
    const unnamed = { app: 'Notepad.exe', app_name: 'Notepad.exe', window_title: 'a' };
    expect(filterContext(unnamed, DEFAULT_CONTEXT_SETTINGS, NOW)?.app_name).toBe('Notepad');
    expect(kept?.window_title).toHaveLength(200);
  });

  it('keeps nothing when the shell found no window', () => {
    expect(filterContext(null, DEFAULT_CONTEXT_SETTINGS, NOW)).toBeNull();
  });
});

describe('matchRules', () => {
  it('matches the app by file name with wildcards, whatever the case', () => {
    expect(appMatches('code.EXE', 'Code.exe')).toBe(true);
    expect(appMatches('Code*.exe', 'Code - Insiders.exe')).toBe(true);
    expect(appMatches('Code.exe', 'Codex.exe')).toBe(false);
    expect(appMatches('', 'Code.exe')).toBe(false);
  });

  it('needs the title to contain the text, whatever the case', () => {
    const rules = [rule({ titlePattern: 'MY-PROJECT', projectId: 'p1', tagPaths: ['Work'] })];
    expect(matchRules(editor, rules)).toEqual([
      { rule_id: 'rule-1', project_id: 'p1', tag_paths: ['work'] },
    ]);
    expect(matchRules({ ...editor, window_title: 'other — Code' }, rules)).toEqual([]);
  });

  it('turns the named part of a pattern into the {project} tag', () => {
    const rules = [
      rule({
        titlePattern: '/— (?<project>[^—]+) — Visual Studio Code$/',
        tagPaths: ['{project}', 'code'],
      }),
    ];
    expect(
      matchRules({ ...editor, window_title: 'a.ts — Side Projects — Visual Studio Code' }, rules)[0]
        ?.tag_paths,
    ).toEqual(['side-project', 'code']);
  });

  it('drops a {project} tag when the pattern named nothing', () => {
    const rules = [rule({ titlePattern: 'my-project', tagPaths: ['{project}', 'code'] })];
    expect(matchRules(editor, rules)[0]?.tag_paths).toEqual(['code']);
  });

  it('never matches, and never throws, on a broken pattern', () => {
    expect(parseTitlePattern('/(unclosed/').kind).toBe('invalid');
    expect(matchRules(editor, [rule({ titlePattern: '/(unclosed/' })])).toEqual([]);
  });

  it('needs a title for a title rule (browsers keep none)', () => {
    const browser = { app: 'Code.exe', app_name: 'Code' };
    expect(matchRules(browser, [rule({ titlePattern: 'my-project' })])).toEqual([]);
    expect(matchRules(browser, [rule({})])).toHaveLength(1);
  });

  it('keeps every match; the first one with a project sets it', () => {
    const matches = matchRules(editor, [
      rule({ id: 'a', tagPaths: ['code'] }),
      rule({ id: 'b', projectId: 'p1', tagPaths: ['code', 'work'] }),
      rule({ id: 'c', projectId: 'p2' }),
    ]);
    expect(ruleOutcome(matches)).toEqual({ projectId: 'p1', tagPaths: ['code', 'work'] });
  });
});

describe('reading an entry context', () => {
  it('reads stored matches and the window, and ignores anything malformed', () => {
    const context = {
      ...editor,
      rule_matches: [{ rule_id: 'r', project_id: null, tag_paths: ['code'] }],
    };
    expect(ruleMatchesOf(context)).toHaveLength(1);
    expect(ruleMatchesOf({ rule_matches: 'nope' })).toEqual([]);
    expect(windowContextOf(context)).toEqual(editor);
    expect(windowContextOf({})).toBeNull();
    expect(windowContextOf({ app: 'x.exe' })).toEqual({ app: 'x.exe', app_name: 'x.exe' });
  });
});
