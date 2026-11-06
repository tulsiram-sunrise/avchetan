import { loadContextSettings, saveContextSettings } from '@avchetan/core';
import { openTestStore } from '@avchetan/db/testing';
import { describe, expect, it } from 'vitest';
import { createCaptureService } from './capture';
import { readDockWindow, togglePause, trayContextState } from './window-context';

const NOW = '2026-11-07T10:00:00.000Z';
const editor = {
  app: 'Code.exe',
  app_name: 'Visual Studio Code',
  window_title: 'api.ts — my-project — Visual Studio Code',
};

describe('window context in the dock', () => {
  it('saves the window and what its rules give with the entry', async () => {
    const { store } = await openTestStore();
    const project = await store.write((tx) =>
      store.repos.projects.create(tx, { name: 'Engineering' }),
    );
    const rule = await store.write((tx) =>
      store.repos.contextRules.create(tx, {
        appPattern: 'code.exe',
        titlePattern: '/— (?<project>[^—]+) — Visual Studio Code$/',
        projectId: project.id,
        tagPaths: ['{project}'],
        enabled: true,
      }),
    );

    const window = await readDockWindow(store, editor, NOW);
    const rawLog = await createCaptureService({ store, timeZone: () => 'UTC' }).capture(
      'fixed the login bug #code',
      window,
    );

    expect(rawLog.context).toEqual({
      ...editor,
      rule_matches: [{ rule_id: rule.id, project_id: project.id, tag_paths: ['my-project'] }],
    });
    const links = await store.repos.tags.forTarget(store.db, 'raw_log', rawLog.id);
    expect(links.map((link) => [link.path, link.isInferred]).sort()).toEqual([
      ['code', false],
      ['my-project', false],
    ]);
  });

  it('keeps nothing over an app on the deny-list, or while paused', async () => {
    const { store } = await openTestStore();
    const vault = { app: 'KeePassXC.exe', app_name: 'KeePassXC', window_title: 'Passwords' };
    expect(await readDockWindow(store, vault, NOW)).toBeNull();

    await togglePause(store, NOW);
    expect(await readDockWindow(store, editor, NOW)).toBeNull();
    // An hour later it records again by itself.
    expect(await readDockWindow(store, editor, '2026-11-07T11:00:00.001Z')).not.toBeNull();
  });

  it('pauses for an hour, says until when in the tray, and resumes', async () => {
    const { store } = await openTestStore();

    const paused = await togglePause(store, NOW);
    expect(paused.pausedUntil).toBe('2026-11-07T11:00:00.000Z');
    expect(trayContextState(paused, NOW)).toEqual({
      enabled: true,
      pausedUntil: expect.stringMatching(/\d/),
    });
    expect(trayContextState(paused, '2026-11-07T11:00:00.001Z').pausedUntil).toBeNull();

    const resumed = await togglePause(store, '2026-11-07T10:10:00.000Z');
    expect(resumed.pausedUntil).toBe('');
    expect((await loadContextSettings(store)).pausedUntil).toBe('');
  });

  it('saves an entry without context when there is none', async () => {
    const { store } = await openTestStore();
    await saveContextSettings(store, { enabled: false });
    const window = await readDockWindow(store, editor, NOW);
    const rawLog = await createCaptureService({ store, timeZone: () => 'UTC' }).capture(
      'note',
      window,
    );
    expect(rawLog.context).toEqual({});
  });
});
