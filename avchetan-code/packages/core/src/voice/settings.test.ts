import { type ClientStore, setSetting } from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { findSpeechModel, SPEECH_MODELS } from '../models/presets';
import {
  DEFAULT_VOICE_SETTINGS,
  insertDictation,
  loadVoiceSettings,
  saveVoiceSettings,
} from './settings';

let store: ClientStore;
beforeEach(async () => {
  ({ store } = await openTestStore({ start: '2026-11-07T10:00:00.000Z' }));
});

describe('voice settings', () => {
  it('starts with no model, automatic language and switching Hindi + English', async () => {
    expect(await loadVoiceSettings(store)).toEqual(DEFAULT_VOICE_SETTINGS);
    expect(DEFAULT_VOICE_SETTINGS).toMatchObject({ model: '', language: 'auto', locale: 'mixed' });
  });

  it('saves and loads each field', async () => {
    await saveVoiceSettings(store, { model: 'whisper-base', language: 'hi', device: 'USB mic' });
    expect(await loadVoiceSettings(store)).toEqual({
      ...DEFAULT_VOICE_SETTINGS,
      model: 'whisper-base',
      language: 'hi',
      device: 'USB mic',
    });
  });

  it('falls back field by field when a stored value is bad', async () => {
    await saveVoiceSettings(store, { model: 'whisper-base' });
    await store.write((tx) => setSetting(tx, 'voice.language', 'klingon', store.clock.now()));
    expect(await loadVoiceSettings(store)).toMatchObject({
      model: 'whisper-base',
      language: 'auto',
    });
  });

  it('refuses to save a value outside its list', async () => {
    await expect(saveVoiceSettings(store, { language: 'fr' as never })).rejects.toThrow();
  });
});

describe('speech models', () => {
  it('are multilingual Whisper files, checked by SHA-256, from a pinned revision', () => {
    expect(SPEECH_MODELS.length).toBeGreaterThan(0);
    for (const model of SPEECH_MODELS) {
      // `.en` models are English-only; the plan mixes Hindi and English.
      expect(model.file).not.toMatch(/\.en[.-]/);
      expect(model.url).toMatch(/\/resolve\/[0-9a-f]{40}\//);
      expect(model.url.endsWith(`/${model.file}`)).toBe(true);
    }
    expect(findSpeechModel('whisper-base')?.file).toBe('ggml-base.bin');
    expect(findSpeechModel('nope')).toBeUndefined();
  });
});

describe('insertDictation', () => {
  it('fills an empty draft', () => {
    expect(insertDictation('', 0, '  ran 5k  today ')).toEqual({
      text: 'ran 5k today',
      cursor: 12,
    });
  });

  it('adds spaces where words would run together', () => {
    expect(insertDictation('note:end', 5, 'call back')).toEqual({
      text: 'note: call back end',
      cursor: 15,
    });
  });

  it('keeps existing spaces', () => {
    expect(insertDictation('a ', 2, 'b')).toEqual({ text: 'a b', cursor: 3 });
  });

  it('keeps Devanagari as spoken', () => {
    expect(insertDictation('', 0, 'आज gym गया').text).toBe('आज gym गया');
  });

  it('leaves the draft alone when nothing was heard', () => {
    expect(insertDictation('hello', 99, '   ')).toEqual({ text: 'hello', cursor: 5 });
  });
});
