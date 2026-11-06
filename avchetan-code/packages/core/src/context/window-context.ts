import { z } from 'zod';
import { normalizeTagPath } from '../normalize/tags';

/**
 * Window context (docs/product/window-context.md): the app and title of the window that was in
 * front when the hotkey opened the dock. The desktop shell reads the raw facts; everything that
 * decides what is kept lives here, so it is tested without Windows.
 */

/** What the shell reports (snake_case, as stored in `raw_logs.context`). */
export const windowContextSchema = z.object({
  app: z.string().min(1),
  app_name: z.string(),
  window_title: z.string(),
});
export type WindowContext = z.infer<typeof windowContextSchema>;

export const MAX_WINDOW_TITLE = 200;

/** Their titles are the page you are on: kept only with `browserTitles`. Lowercase file names. */
export const BROWSER_APPS = [
  'chrome.exe',
  'msedge.exe',
  'firefox.exe',
  'brave.exe',
  'opera.exe',
  'vivaldi.exe',
  'arc.exe',
] as const;

/** Password managers: nothing at all is recorded for them. Editable in Settings. */
export const DEFAULT_DENY_LIST = [
  '1Password.exe',
  'Bitwarden.exe',
  'KeePass.exe',
  'KeePassXC.exe',
  'Dashlane.exe',
  'LastPass.exe',
];

export const contextSettingsSchema = z.object({
  enabled: z.boolean(),
  browserTitles: z.boolean(),
  denyList: z.array(z.string()),
  /** UTC ISO time the pause ends, or '' when not paused (settings can't hold null). */
  pausedUntil: z.string(),
});
export type ContextSettings = z.infer<typeof contextSettingsSchema>;

export const DEFAULT_CONTEXT_SETTINGS: ContextSettings = {
  enabled: true,
  browserTitles: false,
  denyList: DEFAULT_DENY_LIST,
  pausedUntil: '',
};

/** What an entry keeps: the window title is left out for browsers or when empty. */
export type EntryWindowContext = { app: string; app_name: string; window_title?: string };

export function isPaused(settings: Pick<ContextSettings, 'pausedUntil'>, now: string): boolean {
  return settings.pausedUntil !== '' && settings.pausedUntil > now;
}

const sameApp = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function isDenied(app: string, denyList: readonly string[]): boolean {
  return denyList.some((denied) => sameApp(denied, app));
}

export function isBrowser(app: string): boolean {
  return BROWSER_APPS.some((browser) => sameApp(browser, app));
}

/** The program's description; without one (the shell then sends the file name), `Notepad`. */
function displayName(raw: WindowContext): string {
  const name = raw.app_name.trim();
  return name && name !== raw.app ? name : raw.app.replace(/.exe$/i, '');
}

/** Applies the switch, the pause, the deny-list and the browser rule. `now` is a UTC ISO time. */
export function filterContext(
  raw: WindowContext | null,
  settings: ContextSettings,
  now: string,
): EntryWindowContext | null {
  if (!raw || !settings.enabled || isPaused(settings, now)) return null;
  if (isDenied(raw.app, settings.denyList)) return null;
  const title = raw.window_title.trim().slice(0, MAX_WINDOW_TITLE);
  const keepTitle = title !== '' && (settings.browserTitles || !isBrowser(raw.app));
  return {
    app: raw.app,
    app_name: displayName(raw),
    ...(keepTitle ? { window_title: title } : {}),
  };
}

// ---------------------------------------------------------------------------------- rules

/** A row of `context_rules`, as matching needs it. */
export type ContextRuleInput = {
  id: string;
  appPattern: string;
  titlePattern: string | null;
  projectId: string | null;
  tagPaths: readonly string[];
};

export const ruleMatchSchema = z.object({
  rule_id: z.string(),
  project_id: z.string().nullable(),
  tag_paths: z.array(z.string()),
});
export type RuleMatch = z.infer<typeof ruleMatchSchema>;

export type TitlePattern =
  | { kind: 'any' }
  | { kind: 'text'; text: string }
  | { kind: 'regex'; regex: RegExp }
  | { kind: 'invalid'; message: string };

/** `/…/` is a regex (case-insensitive); anything else is text the title must contain. */
export function parseTitlePattern(pattern: string | null): TitlePattern {
  const trimmed = pattern?.trim() ?? '';
  if (trimmed === '') return { kind: 'any' };
  if (trimmed.length > 2 && trimmed.startsWith('/') && trimmed.endsWith('/')) {
    try {
      return { kind: 'regex', regex: new RegExp(trimmed.slice(1, -1), 'i') };
    } catch (error) {
      return { kind: 'invalid', message: error instanceof Error ? error.message : 'Not a pattern' };
    }
  }
  return { kind: 'text', text: trimmed.toLowerCase() };
}

/** `Code*.exe`: `*` is any run of characters, `?` one; case doesn't matter. */
export function appMatches(appPattern: string, app: string): boolean {
  const source = appPattern
    .trim()
    .split('')
    .map((char) =>
      char === '*' ? '.*' : char === '?' ? '.' : char.replace(/[\\^$.|+()[\]{}]/g, '\\$&'),
    )
    .join('');
  return source !== '' && new RegExp(`^${source}$`, 'i').test(app.trim());
}

/** The named group `project` from a regex match, if there is one. */
function titleMatch(pattern: TitlePattern, title: string): { project?: string } | null {
  switch (pattern.kind) {
    case 'any':
      return {};
    case 'invalid':
      return null;
    case 'text':
      return title.toLowerCase().includes(pattern.text) ? {} : null;
    case 'regex': {
      const match = pattern.regex.exec(title);
      if (!match) return null;
      const project = match.groups?.project?.trim();
      return project ? { project } : {};
    }
  }
}

/** `{project}` becomes the named part, made a tag; a path left empty is dropped. */
function ruleTags(tagPaths: readonly string[], project: string | undefined): string[] {
  return tagPaths.flatMap((path) => {
    if (path.includes('{project}') && !project) return [];
    const normalized = normalizeTagPath(path.replaceAll('{project}', project ?? ''));
    return normalized ? [normalized] : [];
  });
}

/**
 * Every enabled rule that matches, in the order given (oldest first). A rule with a broken
 * pattern never matches and never throws: capture must not fail on it.
 */
export function matchRules(
  context: EntryWindowContext | null,
  rules: readonly ContextRuleInput[],
): RuleMatch[] {
  if (!context) return [];
  const title = context.window_title ?? '';
  return rules.flatMap((rule) => {
    if (!appMatches(rule.appPattern, context.app)) return [];
    const matched = titleMatch(parseTitlePattern(rule.titlePattern), title);
    if (!matched) return [];
    return [
      {
        rule_id: rule.id,
        project_id: rule.projectId,
        tag_paths: ruleTags(rule.tagPaths, matched.project),
      },
    ];
  });
}

/** The project the first matching rule with one sets, and all their tags (deduplicated). */
export function ruleOutcome(matches: readonly RuleMatch[]): {
  projectId: string | null;
  tagPaths: string[];
} {
  return {
    projectId: matches.find((match) => match.project_id)?.project_id ?? null,
    tagPaths: [...new Set(matches.flatMap((match) => match.tag_paths))],
  };
}

/** The rule matches stored in an entry's context; anything malformed reads as none. */
export function ruleMatchesOf(context: Record<string, unknown>): RuleMatch[] {
  const parsed = z.array(ruleMatchSchema).safeParse(context.rule_matches);
  return parsed.success ? parsed.data : [];
}

/** The window part of an entry's context, for display; null when there is none. */
export function windowContextOf(context: Record<string, unknown>): EntryWindowContext | null {
  const parsed = z
    .object({
      app: z.string(),
      app_name: z.string().optional(),
      window_title: z.string().optional(),
    })
    .safeParse(context);
  if (!parsed.success) return null;
  const { app, app_name, window_title } = parsed.data;
  return { app, app_name: app_name || app, ...(window_title ? { window_title } : {}) };
}
