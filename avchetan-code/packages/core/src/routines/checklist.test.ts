import type { RoutineOnDay } from '@avchetan/db/sqlite';
import { describe, expect, it } from 'vitest';
import {
  dayChores,
  instantAt,
  openChores,
  parseChoreEveningSettings,
  planChoreEvening,
} from './checklist';

const row = (title: string, kind: string, status: string): RoutineOnDay =>
  ({
    routine: { id: `r-${title}`, title, kind },
    day: { id: `d-${title}`, status, scheduledDate: TODAY },
  }) as unknown as RoutineOnDay;

const TODAY = '2026-11-20';
const ZONE = 'Asia/Kolkata';
const ON = { enabled: true, time: '20:00' as const };

describe('day chores', () => {
  const rows = [
    row('Sleep', 'assumed', 'open'),
    row('Water plants', 'confirm', 'open'),
    row('Read', 'confirm', 'done'),
    row('Walk', 'confirm', 'skipped'),
    row('Something newer', 'from_a_newer_app', 'open'),
  ];

  it('lists only confirm routines', () => {
    expect(dayChores(rows).map((r) => r.routine.title)).toEqual(['Water plants', 'Read', 'Walk']);
  });

  it('treats only open chores as waiting', () => {
    expect(openChores(rows).map((r) => r.routine.title)).toEqual(['Water plants']);
  });
});

describe('evening settings', () => {
  it('defaults to on at 20:00', () => {
    expect(parseChoreEveningSettings(undefined)).toEqual({ enabled: true, time: '20:00' });
    expect(parseChoreEveningSettings('junk')).toEqual({ enabled: true, time: '20:00' });
  });

  it('keeps what it can read', () => {
    expect(parseChoreEveningSettings({ enabled: false, time: '25:00' })).toEqual({
      enabled: false,
      time: '20:00',
    });
    expect(parseChoreEveningSettings({ time: '19:30' })).toEqual({ enabled: true, time: '19:30' });
  });
});

describe('instantAt', () => {
  it('turns a local evening into UTC', () => {
    expect(instantAt(TODAY, '20:00', ZONE)).toBe('2026-11-20T14:30:00.000Z');
  });

  it('uses the evening’s offset on a daylight-saving day', () => {
    // Clocks go forward at 02:00 on 2026-03-29 in Berlin: midnight is +01:00, the evening +02:00.
    expect(instantAt('2026-03-29', '20:00', 'Europe/Berlin')).toBe('2026-03-29T18:00:00.000Z');
    // And back on 2026-10-25: midnight +02:00, evening +01:00.
    expect(instantAt('2026-10-25', '20:00', 'Europe/Berlin')).toBe('2026-10-25T19:00:00.000Z');
  });
});

describe('planChoreEvening', () => {
  const morning = '2026-11-20T04:00:00.000Z';
  const open = [row('Water plants', 'confirm', 'open')];

  it('plans one notification at the evening time', () => {
    expect(
      planChoreEvening({ today: TODAY, now: morning, timeZone: ZONE, settings: ON, open }),
    ).toEqual({
      at: '2026-11-20T14:30:00.000Z',
      title: '1 chore left today',
      body: 'Water plants. Tap to tick it off.',
    });
  });

  it('names three chores and counts the rest', () => {
    const five = ['A', 'B', 'C', 'D', 'E'].map((title) => row(title, 'confirm', 'open'));
    const notice = planChoreEvening({
      today: TODAY,
      now: morning,
      timeZone: ZONE,
      settings: ON,
      open: five,
    });
    expect(notice?.title).toBe('5 chores left today');
    expect(notice?.body).toBe('A, B, C and 2 more. Tap to tick them off.');
  });

  it('plans nothing when off, all ticked, or the time has passed', () => {
    const base = { today: TODAY, now: morning, timeZone: ZONE, settings: ON, open };
    expect(planChoreEvening({ ...base, settings: { ...ON, enabled: false } })).toBeNull();
    expect(planChoreEvening({ ...base, open: [] })).toBeNull();
    expect(planChoreEvening({ ...base, now: '2026-11-20T14:30:00.000Z' })).toBeNull();
  });
});
