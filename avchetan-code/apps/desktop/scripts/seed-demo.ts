/**
 * Fills the DEMO copy's database with years of made-up entries, for the performance baseline
 * (docs/product/finding-and-using-data.md#7-performance-baseline). Dev only.
 *
 *   pnpm --filter @avchetan/desktop demo:seed [--entries 50000] [--years 3] [--db <path>]
 *
 * Quit the demo app first. It refuses any database outside an `app.avchetan.demo` folder,
 * and one that already has entries: rename `%APPDATA%\app.avchetan.demo` to start over.
 * Everything goes through the repositories, as in the app: the rows are queued for sync, so
 * a demo with a hub uploads the whole history (that is part of what is measured).
 * Every name, place and number is made up; the generator is seeded, so runs repeat.
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  type ExtractionPlan,
  openClientStore,
  type PlannedActivity,
  type PlannedTask,
  seedCategoryId,
} from '@avchetan/db/sqlite';
import { createNodeSqliteExecutor } from '@avchetan/db/testing';
import { addDays, derivedId, type LocalDate, localDate, startOfDay } from '@avchetan/shared';

const TIME_ZONE = 'Asia/Kolkata';
const DAY_MS = 86_400_000;

const { values: args } = parseArgs({
  options: {
    entries: { type: 'string', default: '50000' },
    years: { type: 'string', default: '3' },
    db: { type: 'string' },
  },
});
const totalEntries = Number(args.entries);
const years = Number(args.years);
const dbPath = args.db ?? join(process.env.APPDATA ?? '', 'app.avchetan.demo', 'avchetan.db');

if (!dbPath.includes('app.avchetan.demo')) {
  throw new Error(`Refusing ${dbPath}: only a database in an app.avchetan.demo folder.`);
}

// Seeded random numbers (mulberry32), so every run makes the same history.
let seed = 20261111;
function random(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
const between = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));
const round1 = (n: number) => Math.round(n * 10) / 10;

const PEOPLE = [
  'Asha',
  'Ravi',
  'Meera',
  'Kabir',
  'Leo',
  'Sofia',
  'Arjun',
  'Nina',
  'Omar',
  'Priya',
  'Tom',
  'Zara',
  'Vikram',
  'Ines',
  'Dev',
  'Lena',
  'Rohan',
  'Maya',
  'Sam',
  'Tara',
  'Neel',
  'Ana',
  'Ishaan',
  'Clara',
  'Yusuf',
  'Diya',
  'Felix',
  'Rhea',
  'Aditya',
  'Mila',
];
const PROJECTS = [
  'Garden shed',
  'Website redesign',
  'Kitchen renovation',
  'Learn Spanish',
  'Photo album',
  'Thesis draft',
  'Budget app',
  'Bike repair',
];
const PLACES = ['the lake', 'the park', 'the river path', 'the old town', 'the hill road'];
const FOODS = [
  'oats with banana',
  'dal and rice',
  'a paneer wrap',
  'pasta salad',
  'idli and sambar',
  'a veg sandwich',
  'poha',
  'soup and bread',
];
const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
const EXERCISES = ['squats', 'bench press', 'deadlifts', 'rows', 'overhead press', 'lunges'];
const TOPICS = [
  'the budget',
  'the roadmap',
  'the hiring plan',
  'the launch date',
  'the survey results',
  'the venue',
];
const THINGS = [
  'the report',
  'the slides',
  'the invoice',
  'the photos',
  'the contract',
  'the notes',
];
const CHORES = [
  'buy milk',
  'pay the electricity bill',
  'call the plumber',
  'renew the library card',
  'book a dentist visit',
  'water the plants',
  'fix the shelf',
];
const BOOKS = [
  'a novel about sailors',
  'a history of maps',
  'a cookbook',
  'a book on habits',
  'a poetry collection',
];
const MOODS = ['calm', 'restless', 'grateful', 'tired', 'focused', 'cheerful'];

type Generated = {
  content: string;
  tags: string[];
  activities: Omit<PlannedActivity, 'loggedDate'>[];
  tasks: (Omit<PlannedTask, 'dueDate'> & { dueInDays: number | null; owedTo?: string })[];
  people: string[];
};

const cat = (slug: Parameters<typeof seedCategoryId>[0]) => seedCategoryId(slug);
const none = { notes: null, projectId: null, tagPaths: [] as string[] };

function generate(projectIds: Map<string, string>): Generated {
  const roll = random();
  if (roll < 0.1) return hindi();
  if (roll < 0.22) {
    const km = round1(3 + random() * 9);
    const min = Math.round(km * (5 + random() * 2));
    const content = `Ran ${km} km in ${min} minutes around ${pick(PLACES)} #run`;
    return activity(content, ['run'], 'workout', `${km} km run`, {
      distance_km: km,
      duration_min: min,
    });
  }
  if (roll < 0.3) {
    const ex = pick(EXERCISES);
    const kg = between(20, 100);
    const min = between(30, 75);
    const content = `Gym for ${min} min, ${ex} 3x${between(5, 12)} at ${kg} kg`;
    return activity(content, ['gym'], 'workout', `Gym: ${ex}`, {
      duration_min: min,
      exercises: [{ name: ex, sets: 3, weight_kg: kg }],
    });
  }
  if (roll < 0.45) {
    const meal = pick(MEALS);
    const food = pick(FOODS);
    return activity(`Had ${food} for ${meal}`, [], 'diet', `${meal}: ${food}`, { meal });
  }
  if (roll < 0.5) {
    const h = round1(5 + random() * 3.5);
    return activity(`Slept ${h} hours, woke up ${pick(MOODS)}`, ['sleep'], 'health', 'Sleep', {
      sleep_h: h,
      sleep_quality: between(1, 5),
    });
  }
  if (roll < 0.65) {
    const project = pick(PROJECTS);
    const min = between(20, 180);
    const generated = activity(
      `Worked on ${project} for ${min} minutes`,
      [],
      'work',
      `Work on ${project}`,
      {
        duration_min: min,
        deep_work_min: Math.round(min * 0.7),
      },
    );
    const first = generated.activities[0];
    if (first) first.projectId = projectIds.get(project) ?? null;
    return generated;
  }
  if (roll < 0.75) {
    const person = pick(PEOPLE);
    const topic = pick(TOPICS);
    const generated = activity(
      `Meeting with ${person} about ${topic} #meeting`,
      ['meeting'],
      'work',
      `Meeting about ${topic}`,
      {
        duration_min: pick([15, 30, 45, 60]),
      },
    );
    generated.people.push(person);
    return generated;
  }
  if (roll < 0.85) {
    const chore = pick(CHORES);
    return {
      content: `Need to ${chore} ${pick(['today', 'tomorrow', 'this week', 'by Friday'])}`,
      tags: [],
      activities: [],
      tasks: [{ ...none, categoryId: null, title: capitalize(chore), dueInDays: between(0, 6) }],
      people: [],
    };
  }
  if (roll < 0.9) {
    const person = pick(PEOPLE);
    const thing = pick(THINGS);
    return {
      content: `Promised ${person} I would send ${thing} by ${pick(['Monday', 'Thursday', 'next week'])}`,
      tags: [],
      activities: [],
      tasks: [
        {
          ...none,
          categoryId: cat('work'),
          title: `Send ${thing} to ${person}`,
          dueInDays: between(1, 7),
          owedTo: person,
        },
      ],
      people: [person],
    };
  }
  if (roll < 0.95) {
    const pages = between(10, 60);
    return activity(
      `Read ${pages} pages of ${pick(BOOKS)} #reading`,
      ['reading'],
      'other',
      'Reading',
      {
        duration_min: pages * 2,
      },
    );
  }
  const mood = pick(MOODS);
  return activity(
    `Felt ${mood} today. ${pick(['Long walk helped.', 'Too many screens.', 'Good talk with family.', 'Want to sleep earlier.'])}`,
    ['journal'],
    'reflection',
    `Felt ${mood}`,
    {
      mood: between(1, 5),
    },
  );
}

function hindi(): Generated {
  const roll = random();
  if (roll < 0.3) {
    const km = between(2, 10);
    return activity(
      `आज सुबह ${pick(['पार्क', 'झील', 'नदी'])} के पास ${km} किलोमीटर दौड़ लगाई`,
      ['run'],
      'workout',
      `${km} km run`,
      { distance_km: km },
    );
  }
  if (roll < 0.55) {
    return activity(
      `दोपहर में ${pick(['दाल चावल', 'रोटी सब्ज़ी', 'खिचड़ी', 'पोहा'])} खाया`,
      [],
      'diet',
      'Lunch',
      { meal: 'lunch' },
    );
  }
  if (roll < 0.8) {
    const person = pick(PEOPLE);
    const generated = activity(
      `${person} से ${pick(['बजट', 'यात्रा', 'नए घर'])} के बारे में बात की`,
      [],
      'other',
      `Talk with ${person}`,
      {},
    );
    generated.people.push(person);
    return generated;
  }
  const pages = between(10, 50);
  return activity(
    `किताब के ${pages} पन्ने पढ़े, मन ${pick(['शांत', 'खुश', 'थका हुआ'])} है`,
    ['reading'],
    'other',
    'Reading',
    { duration_min: pages * 2 },
  );
}

function activity(
  content: string,
  tags: string[],
  slug: Parameters<typeof seedCategoryId>[0],
  title: string,
  metrics: Record<string, unknown>,
): Generated {
  return {
    content,
    tags,
    activities: [{ ...none, categoryId: cat(slug), title, metrics, tagPaths: [...tags] }],
    tasks: [],
    people: [],
  };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

async function main() {
  if (existsSync(dbPath)) {
    const { raw } = createNodeSqliteExecutor(dbPath);
    const hasLogs = raw
      .prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'raw_logs'")
      .get() as { n: number };
    const count = hasLogs.n
      ? (raw.prepare('SELECT count(*) AS n FROM raw_logs').get() as { n: number }).n
      : 0;
    raw.close();
    if (count > 0) {
      throw new Error(
        `${dbPath} already has ${count} entries. Quit the demo app and rename its folder to start over.`,
      );
    }
  }

  // History ends yesterday; today stays for live use.
  const today = localDate(new Date().toISOString(), TIME_ZONE);
  const days = years * 365;
  const first: LocalDate = addDays(today, -days);
  // Busy and quiet days, adding up to exactly totalEntries.
  const weights = Array.from({ length: days }, () => 0.6 + random() * 0.8);
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  let assigned = 0;
  const perDayCounts = weights.map((w, index) => {
    const n =
      index === days - 1 ? totalEntries - assigned : Math.round((w / weightSum) * totalEntries);
    assigned += n;
    return Math.max(0, n);
  });

  let wallMs = Date.parse(startOfDay(first, TIME_ZONE));
  const { raw, executor } = createNodeSqliteExecutor(dbPath);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  const store = await openClientStore({ executor, wallClock: () => wallMs });

  const projectIds = new Map<string, string>();
  await store.write(async (tx) => {
    for (const name of PROJECTS)
      projectIds.set(name, (await store.repos.projects.create(tx, { name })).id);
  });

  const completions: { at: number; taskId: string }[] = [];
  const began = performance.now();
  let made = 0;

  for (let day = 0; day < days; day++) {
    const dayStart = Date.parse(startOfDay(addDays(first, day), TIME_ZONE));
    const count = perDayCounts[day] ?? 0;
    if (count === 0) continue;
    // Moments between 06:00 and 23:00 local time.
    const moments = Array.from(
      { length: count },
      () => dayStart + (6 + random() * 17) * 3_600_000,
    ).sort((a, b) => a - b);

    await store.write(async (tx) => {
      for (const at of moments) {
        wallMs = at;
        while (completions.length > 0 && (completions[0]?.at ?? Infinity) <= at) {
          const due = completions.shift();
          if (due) await store.repos.tasks.complete(tx, due.taskId);
        }

        const generated = generate(projectIds);
        const log = await store.repos.rawLogs.capture(tx, {
          content: generated.content,
          source: random() < 0.7 ? 'desktop_text' : 'mobile_text',
          capturedTz: TIME_ZONE,
          explicitTagPaths: generated.tags.filter((tag) => generated.content.includes(`#${tag}`)),
        });
        wallMs += between(2_000, 40_000); // Organized a little later, as in the app.
        const loggedDate = localDate(log.capturedAt, TIME_ZONE);
        const plan: ExtractionPlan = {
          rawLogId: log.id,
          status: 'processed',
          model: 'demo:seed',
          version: 1,
          activities: generated.activities.map((item) => ({ ...item, loggedDate })),
          tasks: generated.tasks.map(({ dueInDays, owedTo: _, ...item }) => ({
            ...item,
            dueDate:
              dueInDays === null
                ? null
                : localDate(new Date(at + dueInDays * DAY_MS).toISOString(), TIME_ZONE),
          })),
          logTagPaths: [],
          entities: generated.people.map((name) => ({
            kind: 'person',
            name,
            mentions: generated.tasks.some((task) => task.owedTo === name)
              ? [{ target: { type: 'task', index: 0 }, role: 'owed_to' }]
              : [{ target: { type: 'log' }, role: 'with' }],
          })),
          newCategory: null,
          categorySuggestion: null,
        };
        await store.repos.extraction.apply(tx, plan);

        // Most tasks get done, some late, some never.
        for (const [ordinal, task] of generated.tasks.entries()) {
          if (random() < 0.8) {
            const lateDays = (task.dueInDays ?? 0) + between(-1, 3);
            completions.push({
              at: at + Math.max(1, lateDays) * DAY_MS * (0.5 + random()),
              taskId: derivedId('task', log.id, ordinal),
            });
          }
        }
      }
    });
    completions.sort((a, b) => a.at - b.at);
    made += count;
    if (day % 90 === 0) {
      process.stdout.write(
        `  ${made} entries (${Math.round((performance.now() - began) / 1000)} s)\n`,
      );
    }
  }

  // Leave the clock at the real time, so the app's next writes are ordinary.
  wallMs = Date.now();
  raw.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  const counts = Object.fromEntries(
    ['raw_logs', 'activities', 'tasks', 'tags', 'entities', 'entity_mentions', 'sync_outbox'].map(
      (table) => [
        table,
        (raw.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n,
      ],
    ),
  );
  raw.close();
  const seconds = Math.round((performance.now() - began) / 1000);
  const mb = (statSync(dbPath).size / 1_048_576).toFixed(1);
  process.stdout.write(
    `Done in ${seconds} s: ${dbPath} (${mb} MB)\n${JSON.stringify(counts, null, 2)}\n`,
  );
}

await main();
