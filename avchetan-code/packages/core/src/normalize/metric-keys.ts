/**
 * Metric key registry — the code form of the table in
 * docs/architecture/data-model.md#metric-key-registry. Storage is always metric units.
 *
 * `aliases` maps alternative key names to a factor that converts their value into the
 * canonical unit (`duration_h` → ×60 minutes). `units` maps unit words that may appear in
 * a string value (`"5 mi"`) to factors; a unit in the value overrides the alias factor.
 */

type NumericMetric = {
  key: string;
  type: 'number' | 'int';
  min: number;
  max: number;
  aliases: Readonly<Record<string, number>>;
  units?: Readonly<Record<string, number>>;
};
type EnumMetric = {
  key: string;
  type: 'enum';
  values: readonly string[];
  aliases: Readonly<Record<string, number>>;
};
type OtherMetric = {
  key: string;
  type: 'text' | 'body_part' | 'exercises';
  aliases: Readonly<Record<string, number>>;
};
export type MetricSpec = NumericMetric | EnumMetric | OtherMetric;

const LB = 0.45359237;
const MILE = 1.609344;

export const DURATION_MIN_UNITS = {
  s: 1 / 60,
  sec: 1 / 60,
  secs: 1 / 60,
  second: 1 / 60,
  seconds: 1 / 60,
  m: 1,
  min: 1,
  mins: 1,
  minute: 1,
  minutes: 1,
  h: 60,
  hr: 60,
  hrs: 60,
  hour: 60,
  hours: 60,
} as const;

const DURATION_H_UNITS = Object.fromEntries(
  Object.entries(DURATION_MIN_UNITS).map(([unit, factor]) => [unit, factor / 60]),
);

const DISTANCE_KM_UNITS = {
  km: 1,
  k: 1,
  kms: 1,
  kilometer: 1,
  kilometers: 1,
  kilometre: 1,
  kilometres: 1,
  mi: MILE,
  mile: MILE,
  miles: MILE,
  m: 0.001,
  meter: 0.001,
  meters: 0.001,
  metre: 0.001,
  metres: 0.001,
} as const;

export const WEIGHT_KG_UNITS = {
  kg: 1,
  kgs: 1,
  kilo: 1,
  kilos: 1,
  lb: LB,
  lbs: LB,
  pound: LB,
  pounds: LB,
} as const;

const WATER_ML_UNITS = { ml: 1, l: 1000, liter: 1000, liters: 1000, litre: 1000, litres: 1000 };

export const METRICS: readonly MetricSpec[] = [
  {
    key: 'duration_min',
    type: 'number',
    min: 0,
    max: 1440,
    units: DURATION_MIN_UNITS,
    aliases: {
      duration_min: 1,
      duration: 1,
      duration_mins: 1,
      duration_minutes: 1,
      minutes: 1,
      mins: 1,
      time_min: 1,
      duration_h: 60,
      duration_hours: 60,
      hours: 60,
      duration_s: 1 / 60,
      seconds: 1 / 60,
    },
  },
  {
    key: 'distance_km',
    type: 'number',
    min: 0,
    max: 1000,
    units: DISTANCE_KM_UNITS,
    aliases: {
      distance_km: 1,
      distance: 1,
      km: 1,
      kilometers: 1,
      distance_mi: MILE,
      miles: MILE,
      distance_m: 0.001,
      meters: 0.001,
    },
  },
  {
    key: 'pace_min_per_km',
    type: 'number',
    min: 0,
    max: 60,
    aliases: { pace_min_per_km: 1, pace: 1 },
  },
  { key: 'steps', type: 'int', min: 0, max: 200_000, aliases: { steps: 1, step_count: 1 } },
  { key: 'exercises', type: 'exercises', aliases: { exercises: 1, exercise: 1 } },
  { key: 'rpe', type: 'number', min: 1, max: 10, aliases: { rpe: 1, effort: 1 } },
  {
    key: 'heart_rate_avg_bpm',
    type: 'int',
    min: 20,
    max: 250,
    aliases: { heart_rate_avg_bpm: 1, heart_rate: 1, avg_heart_rate: 1, avg_hr: 1, hr: 1, bpm: 1 },
  },
  {
    key: 'calories_kcal',
    type: 'number',
    min: 0,
    max: 20_000,
    aliases: { calories_kcal: 1, calories: 1, kcal: 1, cal: 1, estimated_calories: 1 },
  },
  {
    key: 'protein_g',
    type: 'number',
    min: 0,
    max: 1000,
    units: { g: 1, gram: 1, grams: 1 },
    aliases: { protein_g: 1, protein: 1, protein_grams: 1 },
  },
  {
    key: 'carbs_g',
    type: 'number',
    min: 0,
    max: 2000,
    units: { g: 1, gram: 1, grams: 1 },
    aliases: { carbs_g: 1, carbs: 1, carbohydrates: 1, carbs_grams: 1 },
  },
  {
    key: 'fat_g',
    type: 'number',
    min: 0,
    max: 1000,
    units: { g: 1, gram: 1, grams: 1 },
    aliases: { fat_g: 1, fat: 1, fat_grams: 1 },
  },
  {
    key: 'water_ml',
    type: 'number',
    min: 0,
    max: 20_000,
    units: WATER_ML_UNITS,
    aliases: { water_ml: 1, water: 1, water_l: 1000, water_liters: 1000 },
  },
  {
    key: 'meal',
    type: 'enum',
    values: ['breakfast', 'lunch', 'dinner', 'snack'],
    aliases: { meal: 1, meal_type: 1 },
  },
  {
    key: 'sleep_h',
    type: 'number',
    min: 0,
    max: 24,
    units: DURATION_H_UNITS,
    aliases: {
      sleep_h: 1,
      sleep: 1,
      sleep_hours: 1,
      hours_slept: 1,
      sleep_min: 1 / 60,
      sleep_minutes: 1 / 60,
    },
  },
  { key: 'sleep_quality', type: 'int', min: 1, max: 5, aliases: { sleep_quality: 1 } },
  { key: 'energy', type: 'int', min: 1, max: 5, aliases: { energy: 1, energy_level: 1 } },
  { key: 'mood', type: 'int', min: 1, max: 5, aliases: { mood: 1, mood_score: 1 } },
  { key: 'stress', type: 'int', min: 1, max: 5, aliases: { stress: 1, stress_level: 1 } },
  { key: 'pain', type: 'int', min: 0, max: 10, aliases: { pain: 1, pain_level: 1 } },
  { key: 'body_part', type: 'body_part', aliases: { body_part: 1, body_parts: 1 } },
  {
    key: 'deep_work_min',
    type: 'number',
    min: 0,
    max: 1440,
    units: DURATION_MIN_UNITS,
    aliases: {
      deep_work_min: 1,
      deep_work: 1,
      deep_work_minutes: 1,
      focus_min: 1,
      focus_minutes: 1,
      deep_work_h: 60,
      focus_hours: 60,
    },
  },
  { key: 'interruptions', type: 'int', min: 0, max: 1000, aliases: { interruptions: 1 } },
  {
    key: 'weight_body_kg',
    type: 'number',
    min: 20,
    max: 400,
    units: WEIGHT_KG_UNITS,
    aliases: {
      weight_body_kg: 1,
      body_weight: 1,
      bodyweight: 1,
      body_weight_kg: 1,
      body_weight_lb: LB,
      body_weight_lbs: LB,
    },
  },
  { key: 'kind', type: 'text', aliases: { kind: 1 } },
];

/** Alias key → (spec, factor). Built once. */
export const METRIC_ALIASES: ReadonlyMap<string, { spec: MetricSpec; factor: number }> = new Map(
  METRICS.flatMap((spec) =>
    Object.entries(spec.aliases).map(([alias, factor]) => [alias, { spec, factor }] as const),
  ),
);
