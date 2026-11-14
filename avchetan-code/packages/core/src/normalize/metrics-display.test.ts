import { describe, expect, it } from 'vitest';
import { exerciseLines, metricsText } from './metrics-display';

describe('metrics display', () => {
  it('writes metrics on one line, without the exercises', () => {
    expect(metricsText({ duration_min: 20, distance_km: 3.25, meal: 'lunch', exercises: [] })).toBe(
      'Duration: 20 min · Distance: 3.3 km · Meal: lunch',
    );
  });

  it('writes each exercise with what it has', () => {
    expect(
      exerciseLines({
        exercises: [{ name: 'Squat', sets: 3, reps: 5, weight_kg: 60 }, { name: 'Plank' }],
      }),
    ).toEqual(['Squat 3×5 @ 60 kg', 'Plank']);
  });
});
